import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Home from '../app/page';

const mockResultsA = {
  query: 'quantum',
  results: [
    {
      arxiv_id: '2301.00001',
      title: 'Quantum Advantage Paper',
      authors: ['Alice Smith'],
      abstract: 'Abstract for quantum advantage.',
      published: '2023-01-15',
      categories: ['quant-ph'],
      pdf_url: 'https://arxiv.org/pdf/2301.00001',
      entry_url: 'https://arxiv.org/abs/2301.00001',
      relevance_score: 0.9,
    },
  ],
  total: 1,
};

const mockResultsB = {
  query: 'machine learning',
  results: [
    {
      arxiv_id: '2301.00002',
      title: 'Deep Learning Scalability',
      authors: ['Bob Jones'],
      abstract: 'Abstract for deep learning scalability.',
      published: '2023-02-10',
      categories: ['cs.LG'],
      pdf_url: 'https://arxiv.org/pdf/2301.00002',
      entry_url: 'https://arxiv.org/abs/2301.00002',
      relevance_score: 0.85,
    },
  ],
  total: 1,
};

function createMockReadableStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe('Search and Synthesis Audit Workflows', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 1. Cache hit cannot be overwritten by an older in-flight request
  it('prevents an older in-flight request from overwriting a subsequent cache hit', async () => {
    // Step 1: Prime cache with Query B
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsB,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    const searchBtn = screen.getByRole('button', { name: /^search$/i });

    fireEvent.change(input, { target: { value: 'machine learning' } });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('Deep Learning Scalability')).toBeInTheDocument();
    });

    // Step 2: Now fire a slow request for Query A
    let resolveSlowFetch: (value: any) => void = () => {};
    const slowPromise = new Promise((resolve) => {
      resolveSlowFetch = resolve;
    });

    (global.fetch as jest.Mock).mockImplementationOnce(() => slowPromise);

    fireEvent.change(input, { target: { value: 'slow quantum query' } });
    fireEvent.click(searchBtn);

    // Step 3: While slow request is in flight, search Query B again (hits cache immediately)
    fireEvent.change(input, { target: { value: 'machine learning' } });
    fireEvent.submit(screen.getByRole('search'));

    // Query B's cached results should be rendered
    await waitFor(() => {
      expect(screen.getByText('Deep Learning Scalability')).toBeInTheDocument();
    });

    // Step 4: Now resolve the older slow fetch with Query A results
    await act(async () => {
      resolveSlowFetch({
        ok: true,
        json: async () => mockResultsA,
      });
      await slowPromise;
    });

    // Verify Query B is STILL displayed and was NOT overwritten by slow Query A
    expect(screen.getByText('Deep Learning Scalability')).toBeInTheDocument();
    expect(screen.queryByText('Quantum Advantage Paper')).not.toBeInTheDocument();
  });

  // 2. Starting a new search cancels and invalidates active synthesis
  it('cancels and invalidates in-flight synthesis when a new search starts', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsA,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    const searchBtn = screen.getByRole('button', { name: /^search$/i });

    fireEvent.change(input, { target: { value: 'quantum' } });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('Quantum Advantage Paper')).toBeInTheDocument();
    });

    // Mock long-running synthesis stream
    let streamCancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: Initial synthesis token\n\n'),
        );
      },
      cancel() {
        streamCancelled = true;
      },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const synthBtn = screen.getByRole('button', { name: /Generate topic synthesis/i });
    fireEvent.click(synthBtn);

    await waitFor(() => {
      expect(screen.getByText(/Initial synthesis token/i)).toBeInTheDocument();
    });

    // Now start a new search
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsB,
    });

    fireEvent.change(input, { target: { value: 'machine learning' } });
    fireEvent.click(searchBtn);

    // Synthesis should be cleared and its stream cancelled
    await waitFor(() => {
      expect(screen.queryByText(/Initial synthesis token/i)).not.toBeInTheDocument();
    });
    expect(streamCancelled).toBe(true);
  });

  // 3. SSE transport preserves whitespace, newlines, and citations split across chunk boundaries
  it('preserves exact whitespace, newlines, and citation markers split across chunks', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsA,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    const searchBtn = screen.getByRole('button', { name: /^search$/i });

    fireEvent.change(input, { target: { value: 'quantum' } });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('Quantum Advantage Paper')).toBeInTheDocument();
    });

    // Stream with split citation marker: chunk 1 has "[SOURCE ", chunk 2 has "1]"
    // and whitespace: leading space, newlines
    const sseChunks = [
      'event: sources\ndata: [{"source_index":1,"arxiv_id":"2301.00001","title":"Quantum Advantage Paper","authors":["Alice Smith"],"published":"2023","entry_url":"https://arxiv.org/abs/2301.00001"}]\n\n',
      'data: According to [SOURCE \n\n',
      'data: 1], quantum systems\n\n',
      'data:  exhibit speedups.\n\n',
      'event: validation\ndata: {"cited_sources":[1],"invalid_citations":[],"has_hallucinations":false,"citation_count":1}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: createMockReadableStream(sseChunks),
    });

    const synthBtn = screen.getByRole('button', { name: /Generate topic synthesis/i });
    fireEvent.click(synthBtn);

    await waitFor(() => {
      expect(screen.getByText(/Grounding Sources \(1 retrieved papers\)/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Grounding reference: \[SOURCE 1\]/i })).toBeInTheDocument();
      expect(screen.getByText(/quantum systems exhibit speedups\./i)).toBeInTheDocument();
      expect(screen.getByText(/Citations Verified/i)).toBeInTheDocument();
    });
  });

  // 4. Synthesis cancellation followed by new synthesis
  it('cancels active synthesis and starts a clean new synthesis', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsA,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    const searchBtn = screen.getByRole('button', { name: /^search$/i });

    fireEvent.change(input, { target: { value: 'quantum' } });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('Quantum Advantage Paper')).toBeInTheDocument();
    });

    // First synthesis stream
    let cancelCalled = false;
    const stream1 = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: First synthesis in progress...\n\n'));
      },
      cancel() {
        cancelCalled = true;
      },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: stream1,
    });

    const synthBtn = screen.getByRole('button', { name: /Generate topic synthesis/i });
    fireEvent.click(synthBtn);

    await waitFor(() => {
      expect(screen.getByText(/First synthesis in progress/i)).toBeInTheDocument();
    });

    // User clicks Cancel
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(cancelCalled).toBe(true);

    // Now start a second synthesis
    const stream2Chunks = [
      'data: Second fresh synthesis.\n\n',
      'event: done\ndata: [DONE]\n\n',
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: createMockReadableStream(stream2Chunks),
    });

    fireEvent.click(screen.getByRole('button', { name: /Generate topic synthesis/i }));

    await waitFor(() => {
      expect(screen.getByText(/Second fresh synthesis\./i)).toBeInTheDocument();
      expect(screen.queryByText(/First synthesis in progress/i)).not.toBeInTheDocument();
    });
  });

  // 5. Year control accurately describes lower-bound behavior and reset restores defaults
  it('describes year control lower-bound behavior and enforces reset to default', async () => {
    render(<Home />);

    // Check year control label and lower bound semantics
    const yearSlider = screen.getByLabelText(/Earliest publication year/i);
    expect(yearSlider).toBeInTheDocument();
    expect(screen.getByText('Earliest Publication Year')).toBeInTheDocument();
    expect(screen.getByText(/From:/i)).toBeInTheDocument();
    expect(screen.getAllByText(/2015 or later/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/All \(2015\+\)/i)).toBeInTheDocument();

    // Move slider to 2022
    fireEvent.change(yearSlider, { target: { value: '2022' } });

    expect(screen.getAllByText(/2022 or later/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/Lower bound/i)).toBeInTheDocument();
    expect(screen.getByText(/1 active/i)).toBeInTheDocument();

    // Select category cs.AI -> active count should be 2
    const categoryBtn = screen.getByRole('button', { name: /Add cs.AI filter/i });
    fireEvent.click(categoryBtn);
    expect(screen.getByText(/2 active/i)).toBeInTheDocument();

    // Submit search and verify active filter state matches the submitted request
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsA,
    });

    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search',
        expect.objectContaining({
          body: expect.stringContaining('"date_from":"2022-01-01"'),
        }),
      );
    });

    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    );
    expect(callBody.filters.date_from).toBe('2022-01-01');
    expect(callBody.filters.categories).toEqual(['cs.AI']);

    // Now test reset filters
    const resetBtn = screen.getByRole('button', { name: /Reset filters/i });
    fireEvent.click(resetBtn);

    // Active filters pill should disappear and slider should reset to MIN_YEAR (2015)
    expect(screen.queryByText(/active/i)).not.toBeInTheDocument();
    expect(screen.getByText(/All \(2015\+\)/i)).toBeInTheDocument();
    expect(categoryBtn).toHaveAttribute('aria-pressed', 'false');

    // Submit search after reset and verify request has no active filters
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResultsA,
    });

    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const resetCallBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[1][1].body as string,
    );
    expect(resetCallBody.filters.date_from).toBeUndefined();
    expect(resetCallBody.filters.categories).toBeUndefined();
  });
});

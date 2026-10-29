import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import Home from '../app/page';

// Mock sample search results
const mockSearchResults = {
  query: 'quantum computing',
  results: [
    {
      arxiv_id: '2301.00001',
      title: 'Quantum Supremacy via Random Circuit Sampling',
      authors: ['Alice Smith', 'Bob Jones', 'Charlie Brown'],
      abstract: 'We demonstrate quantum computational supremacy using 53 qubits.',
      published: '2023-01-15',
      categories: ['cs.AI', 'quant-ph'],
      pdf_url: 'https://arxiv.org/pdf/2301.00001',
      entry_url: 'https://arxiv.org/abs/2301.00001',
      relevance_score: 0.88,
      ranking_degraded: false,
    },
    {
      arxiv_id: '2301.00002',
      title: 'Error Mitigation in Noisy Intermediate-Scale Quantum Processors',
      authors: ['Dave Miller'],
      abstract: 'Techniques for error mitigation in NISQ devices.',
      published: '2023-02-10',
      categories: ['quant-ph'],
      pdf_url: 'https://arxiv.org/pdf/2301.00002',
      entry_url: 'https://arxiv.org/abs/2301.00002',
      relevance_score: 0.72,
      ranking_degraded: false,
    },
  ],
  total: 2,
};

describe('Home page - End to End Workflows', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Initial State & Example Queries
  // -------------------------------------------------------------------------
  it('renders initial empty search prompt with telescope icon', () => {
    render(<Home />);
    expect(screen.getByText('Discover Research')).toBeInTheDocument();
    expect(screen.getByText('Search for any research topic')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search arXiv topics/i)).toBeInTheDocument();
  });

  it('populates search input when clicking an example query', () => {
    render(<Home />);
    const exampleButton = screen.getByRole('button', {
      name: /Fill search with: Efficient vision transformers/i,
    });
    fireEvent.click(exampleButton);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i) as HTMLInputElement;
    expect(input.value).toBe('Efficient vision transformers');
  });

  // -------------------------------------------------------------------------
  // 2. Search Submission & Result Display
  // -------------------------------------------------------------------------
  it('submits search query and displays paper cards and relevance meters', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    const submitButton = screen.getByRole('button', { name: /^search$/i });

    fireEvent.change(input, { target: { value: 'quantum computing' } });
    fireEvent.click(submitButton);

    // Verify loading skeletons appear
    expect(screen.getByRole('status', { name: /loading search results/i })).toBeInTheDocument();

    // Wait for results to render
    await waitFor(() => {
      expect(
        screen.getByText('Quantum Supremacy via Random Circuit Sampling'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Error Mitigation in Noisy Intermediate-Scale Quantum Processors'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alice Smith, Bob Jones, Charlie Brown')).toBeInTheDocument();
    expect(screen.getByText('88.0%')).toBeInTheDocument();
    expect(screen.getByText('72.0%')).toBeInTheDocument();

    // Verify fetch call payload
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"query":"quantum computing"'),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 3. Filter Behavior (Categories, Year, Count, Reset)
  // -------------------------------------------------------------------------
  it('applies category and year filters to the search request payload', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const categoryBtn = screen.getByRole('button', { name: /Add cs.AI filter/i });
    fireEvent.click(categoryBtn);
    expect(categoryBtn).toHaveAttribute('aria-pressed', 'true');

    // Change result count to 25
    const select = screen.getByLabelText(/Result Count/i);
    fireEvent.change(select, { target: { value: '25' } });

    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum AI' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/search',
        expect.objectContaining({
          body: expect.stringContaining('"categories":["cs.AI"]'),
        }),
      );
    });

    const callBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    );
    expect(callBody.max_results).toBe(25);
    expect(callBody.filters.categories).toEqual(['cs.AI']);
  });

  it('resets filters when clicking reset filters button', async () => {
    render(<Home />);
    const categoryBtn = screen.getByRole('button', { name: /Add cs.AI filter/i });
    fireEvent.click(categoryBtn);

    const resetBtn = screen.getByRole('button', { name: /Reset filters/i });
    fireEvent.click(resetBtn);

    expect(categoryBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // -------------------------------------------------------------------------
  // 4. Loading, Error, and Empty States
  // -------------------------------------------------------------------------
  it('displays error state when search fails and retries upon clicking Retry', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResults,
      });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'error query' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/arXiv is currently unavailable/i)).toBeInTheDocument();

    // Click retry button
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Quantum Supremacy via Random Circuit Sampling'),
      ).toBeInTheDocument();
    });
  });

  it('displays "No papers found" when search yields zero results', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: 'empty query', results: [], total: 0 }),
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'empty query' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('No papers found')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Paper Selection for Graph & Reading List
  // -------------------------------------------------------------------------
  it('toggles paper selection for research graph and persists to localStorage', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    const addGraphBtn = screen.getByRole('button', {
      name: /Add Quantum Supremacy via Random Circuit Sampling to graph/i,
    });
    fireEvent.click(addGraphBtn);

    // Verify button state flips
    expect(screen.getByText('✓ In Graph')).toBeInTheDocument();

    // Verify localStorage updated
    const savedGraph = JSON.parse(
      window.localStorage.getItem('scholytics.selectedForGraph') || '[]',
    );
    expect(savedGraph).toContain('2301.00001');
  });

  it('saves paper to Reading List and manages reading list panel', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', {
      name: /Save Quantum Supremacy via Random Circuit Sampling to reading list/i,
    });
    fireEvent.click(saveBtn);
    expect(screen.getByText('★ Saved')).toBeInTheDocument();

    // Open reading list
    const readingListBtn = screen.getByRole('button', { name: /Reading list \(1 saved\)/i });
    fireEvent.click(readingListBtn);

    expect(screen.getByRole('dialog', { name: /reading list/i })).toBeInTheDocument();

    // Remove from reading list
    const removeBtn = within(screen.getByRole('dialog', { name: /reading list/i })).getByRole('button', {
      name: /Remove/i,
    });
    fireEvent.click(removeBtn);

    expect(screen.getByText(/No saved papers yet/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 6. Individual Paper Summary
  // -------------------------------------------------------------------------
  it('fetches and displays paper summary upon clicking Summarize', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResults,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          arxiv_id: '2301.00001',
          summary: 'This paper demonstrates quantum supremacy using random circuit sampling.',
        }),
      });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Quantum Supremacy via Random Circuit Sampling/i,
    });
    fireEvent.click(summarizeBtn);

    await waitFor(() => {
      expect(
        screen.getByText('This paper demonstrates quantum supremacy using random circuit sampling.'),
      ).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/papers/2301.00001/summarize',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // -------------------------------------------------------------------------
  // 7. Synthesis Stream Consumption & Cancellation
  // -------------------------------------------------------------------------
  it('streams topic synthesis tokens incrementally and displays completed result', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum computing' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    // Mock readable stream for synthesis
    const sseChunks = [
      'data: Quantum computing harnesses [SOURCE 1] superposition.\n\n',
      'data: Error mitigation [SOURCE 2] remains essential.\n\n',
      'event: done\ndata: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const synthBtn = screen.getByRole('button', { name: /Generate topic synthesis/i });
    await act(async () => {
      fireEvent.click(synthBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Quantum computing harnesses \[SOURCE 1\] superposition/i),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Error mitigation \[SOURCE 2\] remains essential/i),
    ).toBeInTheDocument();

    // Copy button appears upon completion
    expect(screen.getByRole('button', { name: /Copy synthesis to clipboard/i })).toBeInTheDocument();
  });

  it('allows cancelling in-flight synthesis stream', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum computing' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: Partial chunk before cancel\n\n'));
      },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const synthBtn = screen.getByRole('button', { name: /Generate topic synthesis/i });
    await act(async () => {
      fireEvent.click(synthBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Partial chunk before cancel/i)).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.getByRole('button', { name: /Generate topic synthesis/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 6. Paper Comparison Matrix Workflow
  // -------------------------------------------------------------------------
  it('toggles paper comparison selection and renders structured matrix', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    const input = screen.getByPlaceholderText(/Search arXiv topics/i);
    fireEvent.change(input, { target: { value: 'quantum computing' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy via Random Circuit Sampling')).toBeInTheDocument();
    });

    // Toggle both papers into comparison
    const compareBtn1 = screen.getByRole('button', {
      name: /Add Quantum Supremacy via Random Circuit Sampling to comparison/i,
    });
    fireEvent.click(compareBtn1);
    expect(compareBtn1).toHaveTextContent('✓ In Compare');

    const compareBtn2 = screen.getByRole('button', {
      name: /Add Error Mitigation in Noisy Intermediate-Scale Quantum Processors to comparison/i,
    });
    fireEvent.click(compareBtn2);
    expect(compareBtn2).toHaveTextContent('✓ In Compare');

    // The compare button in the synthesis panel now reflects 2 selected papers
    const executeCompareBtn = screen.getByRole('button', {
      name: /Compare selected papers/i,
    });
    expect(executeCompareBtn).toHaveTextContent('Compare (2)');

    // Mock comparison response
    const mockComparisonResult = {
      papers: [
        {
          arxiv_id: '2301.00001',
          title: 'Quantum Supremacy via Random Circuit Sampling',
          entry_url: 'https://arxiv.org/abs/2301.00001',
          pdf_url: 'https://arxiv.org/pdf/2301.00001',
          published: '2023-01-15',
          authors: ['Alice Smith'],
          research_question: 'Demonstrate quantum computational advantage',
          method: 'Random circuit sampling on Sycamore',
          datasets_or_setup: '53 superconducting qubits',
          reported_findings: 'Cross-entropy benchmarking shows superiority over classical supercomputers',
          limitations: 'Not explicitly stated in abstract',
        },
        {
          arxiv_id: '2301.00002',
          title: 'Error Mitigation in Noisy Intermediate-Scale Quantum Processors',
          entry_url: 'https://arxiv.org/abs/2301.00002',
          pdf_url: 'https://arxiv.org/pdf/2301.00002',
          published: '2023-02-10',
          authors: ['Dave Miller'],
          research_question: 'Mitigate gate noise in NISQ devices',
          method: 'Zero-noise extrapolation and probabilistic error cancellation',
          datasets_or_setup: 'Not explicitly reported in abstract',
          reported_findings: 'Extends coherence limit by factor of 3',
          limitations: 'Exponential sampling overhead for deep circuits',
        },
      ],
      similarities: ['Both evaluate superconducting quantum architectures.'],
      differences: ['Paper 1 benchmarks sampling while Paper 2 develops noise mitigation techniques.'],
      research_gaps: ['Scalability to fault-tolerant threshold without exponential sampling cost.'],
      disclaimer: 'Comparative matrix generated from author-reported abstracts.',
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockComparisonResult,
    });

    await act(async () => {
      fireEvent.click(executeCompareBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Comparative Analysis Matrix')).toBeInTheDocument();
    });

    expect(screen.getByText('Demonstrate quantum computational advantage')).toBeInTheDocument();
    expect(screen.getByText('Mitigate gate noise in NISQ devices')).toBeInTheDocument();
    expect(screen.getByText('53 superconducting qubits')).toBeInTheDocument();
    expect(screen.getByText('Both evaluate superconducting quantum architectures.')).toBeInTheDocument();
    expect(screen.getByText(/Model Interpretation/i)).toBeInTheDocument();
  });
});

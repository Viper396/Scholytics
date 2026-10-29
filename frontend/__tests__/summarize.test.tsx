import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let nodeClickHandler: ((e: any, d: any) => void) | null = null;

jest.mock('d3', () => {
  const makeSelection = (): any => {
    const sel: any = {
      selectAll: () => sel,
      remove: () => sel,
      append: () => sel,
      attr: () => sel,
      style: () => sel,
      text: () => sel,
      data: () => sel,
      join: () => sel,
      call: () => sel,
      transition: () => sel,
      duration: () => sel,
      on: (event: string, fn: any) => {
        if (event === 'click' && fn.length >= 2) {
          nodeClickHandler = fn;
        }
        return sel;
      },
    };
    return sel;
  };

  const makeLink = (): any => {
    const link: any = {
      id: () => link,
      distance: () => link,
      strength: () => link,
      links: () => link,
    };
    return link;
  };

  return {
    select: () => makeSelection(),
    scaleOrdinal: () => {
      const scale: any = () => '#06b6d4';
      scale.domain = () => scale;
      scale.range = () => scale;
      return scale;
    },
    zoom: () => ({
      scaleExtent: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      scaleBy: jest.fn(),
    }),
    drag: () => ({
      on: jest.fn().mockReturnThis(),
    }),
    forceSimulation: () => {
      const sim: any = {
        force: () => sim,
        nodes: () => [],
        alpha: () => sim,
        alphaTarget: () => sim,
        alphaDecay: () => sim,
        restart: () => sim,
        stop: () => sim,
        on: () => sim,
      };
      return sim;
    },
    forceLink: () => makeLink(),
    forceManyBody: () => ({
      strength: jest.fn().mockReturnThis(),
    }),
    forceCenter: () => jest.fn(),
    forceCollide: () => ({
      radius: jest.fn().mockReturnThis(),
    }),
  };
});

const mockParams = new URLSearchParams('ids=2301.00001');
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockParams,
}));

import Home from '../app/page';
import GraphPage from '../app/graph/page';

const mockSearchResults = {
  query: 'quantum computing',
  results: [
    {
      arxiv_id: '2301.00001',
      title: 'Quantum Supremacy Testing',
      authors: ['Alice Smith'],
      abstract: 'Abstract regarding quantum computing benchmarking.',
      published: '2023-01-15',
      categories: ['quant-ph'],
      pdf_url: 'https://arxiv.org/pdf/2301.00001',
      entry_url: 'https://arxiv.org/abs/2301.00001',
      relevance_score: 0.95,
      ranking_degraded: false,
    },
  ],
  total: 1,
};

const mockGraphResponse = {
  nodes: [
    {
      id: '2301.00001',
      title: 'Quantum Supremacy Testing',
      authors: ['Alice Smith'],
      published: '2023-01-15',
      categories: ['quant-ph'],
      relevance_score: 0.95,
    },
  ],
  edges: [],
};

const mockPaperDetails = {
  arxiv_id: '2301.00001',
  title: 'Quantum Supremacy Testing',
  authors: ['Alice Smith'],
  abstract: 'Detailed abstract about quantum circuits from details API.',
  published: '2023-01-15',
  categories: ['quant-ph'],
  pdf_url: 'https://arxiv.org/pdf/2301.00001',
  entry_url: 'https://arxiv.org/abs/2301.00001',
};

describe('Summarization Workflows (Search Card and Graph View)', () => {
  beforeEach(() => {
    nodeClickHandler = null;
    window.localStorage.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Search Card Summarization Tests
  // ---------------------------------------------------------------------------
  it('displays safe error detail and allows working retry when backend returns 502/401/429/503', async () => {
    // 1. Initial search
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/Search arXiv topics/i), {
      target: { value: 'quantum' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy Testing')).toBeInTheDocument();
    });

    // 2. Click summarize -> Backend returns 502 Bad Gateway with safe detail
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        detail: 'Groq authentication failed: Invalid GROQ_API_KEY. Please verify your API key in environment settings.',
      }),
    });

    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Quantum Supremacy Testing/i,
    });
    fireEvent.click(summarizeBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Groq authentication failed: Invalid GROQ_API_KEY/i),
      ).toBeInTheDocument();
    });

    // Verify Retry button is present and accessible
    const retryBtn = screen.getByRole('button', { name: /Retry summary for Quantum Supremacy Testing/i });
    expect(retryBtn).toBeInTheDocument();

    // 3. Click Retry -> Backend succeeds
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        arxiv_id: '2301.00001',
        summary: 'Successfully generated summary after retry.',
      }),
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Successfully generated summary after retry.')).toBeInTheDocument();
    });

    // Ensure it did not fabricate or replace summary with the raw abstract
    expect(
      screen.queryByText(/Groq authentication failed/i),
    ).not.toBeInTheDocument();
  });

  it('guards against duplicate clicks while summarization is in flight on search card', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResults,
    });

    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/Search arXiv topics/i), {
      target: { value: 'quantum' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy Testing')).toBeInTheDocument();
    });

    // Create a slow unresolved promise for summarize
    let resolveSummary: (val: any) => void;
    const slowPromise = new Promise((resolve) => {
      resolveSummary = resolve;
    });

    (global.fetch as jest.Mock).mockImplementationOnce(() => slowPromise);

    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Quantum Supremacy Testing/i,
    });

    // First click
    fireEvent.click(summarizeBtn);
    expect(screen.getByText('Generating summary…')).toBeInTheDocument();

    // Duplicate rapid clicks while loading
    fireEvent.click(summarizeBtn);
    fireEvent.click(summarizeBtn);

    // Only 2 fetch calls should have happened: 1 for search, 1 for summarize
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);

    // Resolve the slow promise
    resolveSummary!({
      ok: true,
      json: async () => ({
        arxiv_id: '2301.00001',
        summary: 'Finished summary.',
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Finished summary.')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Graph View Summarization Tests
  // ---------------------------------------------------------------------------
  it('reuses loaded paper title and abstract in graph view to avoid arXiv refetch', async () => {
    let summarizePayload: any = null;

    (global.fetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      if (url.includes('/api/graph')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockGraphResponse,
        });
      }
      if (url.includes('/api/papers/2301.00001/summarize')) {
        summarizePayload = options?.body ? JSON.parse(options.body) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            arxiv_id: '2301.00001',
            summary: 'Grounded summary using graph node metadata.',
          }),
        });
      }
      if (url.includes('/api/papers/2301.00001')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPaperDetails,
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<GraphPage />);

    // Wait for graph fetch to complete and D3 simulation to attach click handler
    await waitFor(() => {
      expect(nodeClickHandler).not.toBeNull();
    });

    // Simulate clicking node 2301.00001
    act(() => {
      nodeClickHandler!({ stopPropagation: () => {} }, mockGraphResponse.nodes[0]);
    });

    // Wait for graph node details to populate
    await waitFor(() => {
      expect(
        screen.getByText('Detailed abstract about quantum circuits from details API.'),
      ).toBeInTheDocument();
    });

    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Quantum Supremacy Testing/i,
    });
    fireEvent.click(summarizeBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Grounded summary using graph node metadata.'),
      ).toBeInTheDocument();
    });

    // Verify fetch call passed title and abstract in the body
    expect(summarizePayload).not.toBeNull();
    expect(summarizePayload.title).toBe('Quantum Supremacy Testing');
    expect(summarizePayload.abstract).toBe(
      'Detailed abstract about quantum circuits from details API.',
    );
  });

  it('displays safe error detail and retry button in graph view when Groq fails', async () => {
    let summarizeAttempts = 0;

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/graph')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockGraphResponse,
        });
      }
      if (url.includes('/api/papers/2301.00001/summarize')) {
        summarizeAttempts++;
        if (summarizeAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: async () => ({
              detail: 'Groq rate limit reached. Please wait a moment before requesting another summary.',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            arxiv_id: '2301.00001',
            summary: 'Successful summary upon retry in graph.',
          }),
        });
      }
      if (url.includes('/api/papers/2301.00001')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPaperDetails,
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<GraphPage />);

    await waitFor(() => {
      expect(nodeClickHandler).not.toBeNull();
    });

    act(() => {
      nodeClickHandler!({ stopPropagation: () => {} }, mockGraphResponse.nodes[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Quantum Supremacy Testing')).toBeInTheDocument();
    });

    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Quantum Supremacy Testing/i,
    });
    fireEvent.click(summarizeBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Groq rate limit reached/i),
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry summary for Quantum Supremacy Testing/i });
    expect(retryBtn).toBeInTheDocument();

    // Click retry
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Successful summary upon retry in graph.')).toBeInTheDocument();
    });
    expect(summarizeAttempts).toBe(2);
  });
});

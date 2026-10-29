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
        if (event === 'click' && fn && fn.length >= 2) {
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
      transform: jest.fn(),
    }),
    zoomIdentity: {
      translate: jest.fn().mockReturnThis(),
      scale: jest.fn().mockReturnThis(),
    },
    drag: () => ({
      on: jest.fn().mockReturnThis(),
    }),
    forceSimulation: () => {
      const sim: any = {
        force: () => sim,
        nodes: () => [
          { id: '2301.00001', x: 100, y: 100, relevance_score: 0.9 },
          { id: '2301.00002', x: 200, y: 200, relevance_score: 0.8 },
        ],
        alpha: (val?: any) => (val !== undefined ? sim : 0.05),
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

const mockSearchParams = new URLSearchParams('ids=2301.00001,2301.00002');
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import GraphPage from '../app/graph/page';

const mockGraphData = {
  nodes: [
    {
      id: '2301.00001',
      title: 'Quantum Supremacy Testing',
      authors: ['Alice Smith', 'Bob Jones'],
      published: '2023-01-15',
      categories: ['quant-ph', 'cs.IT'],
      relevance_score: 0.95,
    },
    {
      id: '2301.00002',
      title: 'NISQ Noise Mitigation',
      authors: ['Alice Smith', 'Charlie Brown'],
      published: '2023-02-10',
      categories: ['quant-ph'],
      relevance_score: 0.82,
    },
  ],
  edges: [
    {
      source: '2301.00001',
      target: '2301.00002',
      type: 'co-author',
      weight: 1,
    },
    {
      source: '2301.00001',
      target: '2301.00002',
      type: 'same-field',
      weight: 1,
    },
  ],
};

const mockPaper1Details = {
  arxiv_id: '2301.00001',
  title: 'Quantum Supremacy Testing',
  authors: ['Alice Smith', 'Bob Jones'],
  abstract: 'Comprehensive benchmark for quantum sampling advantage.',
  published: '2023-01-15',
  categories: ['quant-ph', 'cs.IT'],
  pdf_url: 'https://arxiv.org/pdf/2301.00001',
  entry_url: 'https://arxiv.org/abs/2301.00001',
};

const mockPaper2Details = {
  arxiv_id: '2301.00002',
  title: 'NISQ Noise Mitigation',
  authors: ['Alice Smith', 'Charlie Brown'],
  abstract: 'Zero-noise extrapolation methods in superconducting processors.',
  published: '2023-02-10',
  categories: ['quant-ph'],
  pdf_url: 'https://arxiv.org/pdf/2301.00002',
  entry_url: 'https://arxiv.org/abs/2301.00002',
};

describe('Research Graph Page Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn((url: string) => {
      if (url.includes('/api/graph')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockGraphData,
        });
      }
      if (url.includes('/api/papers/2301.00001')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPaper1Details,
        });
      }
      if (url.includes('/api/papers/2301.00002')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockPaper2Details,
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it('renders research graph with clear non-citation relationship notice and legend', async () => {
    render(<GraphPage />);

    expect(screen.getByText('Research Relationship Graph')).toBeInTheDocument();
    expect(
      screen.getByText((content, element) => {
        return (
          element?.tagName.toLowerCase() === 'p' &&
          /edges represent shared authors or shared arXiv categories/i.test(element.textContent || '') &&
          /not citation relationships/i.test(element.textContent || '')
        );
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText(/Research relationship graph with 2 papers/i)).toBeInTheDocument();
    });

    // Check legend items
    expect(screen.getByText(/Solid cyan:/i)).toBeInTheDocument();
    expect(screen.getByText(/Dashed grey:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Relationships show collaboration & field similarity — NOT citations/i),
    ).toBeInTheDocument();

    // Check toolbar controls
    expect(screen.getByRole('button', { name: /Zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fit graph to view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset graph layout/i })).toBeInTheDocument();
  });

  it('allows keyboard and touch node selection through accessible dropdown selector', async () => {
    render(<GraphPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Select paper in graph/i)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Select paper in graph/i);
    fireEvent.change(select, { target: { value: '2301.00001' } });

    // Node details should populate
    await waitFor(() => {
      expect(screen.getByText('Comprehensive benchmark for quantum sampling advantage.')).toBeInTheDocument();
    });

    // Verify original arXiv and PDF links
    expect(screen.getByRole('link', { name: /Open arXiv abstract page for: Quantum Supremacy Testing/i })).toHaveAttribute(
      'href',
      'https://arxiv.org/abs/2301.00001',
    );
    expect(screen.getByRole('link', { name: /Open PDF for: Quantum Supremacy Testing/i })).toHaveAttribute(
      'href',
      'https://arxiv.org/pdf/2301.00001',
    );

    // Verify connected papers in graph shows relationship with non-citation clarification
    expect(screen.getByText(/Connected in Graph/i)).toBeInTheDocument();
    expect(screen.getAllByText('NISQ Noise Mitigation').length).toBeGreaterThanOrEqual(1);
  });

  it('supports selecting papers for comparison and generating comparison matrix on the graph view', async () => {
    const mockCompareResponse = {
      papers: [
        {
          arxiv_id: '2301.00001',
          title: 'Quantum Supremacy Testing',
          entry_url: 'https://arxiv.org/abs/2301.00001',
          pdf_url: 'https://arxiv.org/pdf/2301.00001',
          published: '2023-01-15',
          authors: ['Alice Smith'],
          research_question: 'Evaluate quantum sampling speedups',
          method: 'Random circuit sampling',
          datasets_or_setup: '53-qubit array',
          reported_findings: 'Exponential runtime superiority over classical supercomputers',
          limitations: 'Limited coherence time',
        },
        {
          arxiv_id: '2301.00002',
          title: 'NISQ Noise Mitigation',
          entry_url: 'https://arxiv.org/abs/2301.00002',
          pdf_url: 'https://arxiv.org/pdf/2301.00002',
          published: '2023-02-10',
          authors: ['Charlie Brown'],
          research_question: 'Mitigate gate noise in NISQ',
          method: 'Zero-noise extrapolation',
          datasets_or_setup: 'Superconducting transmon processor',
          reported_findings: 'Coherence extended by 3x',
          limitations: 'Sampling overhead scales with noise',
        },
      ],
      similarities: ['Both benchmark superconducting quantum hardware.'],
      differences: ['Paper 1 measures sampling throughput whereas Paper 2 mitigates noise.'],
      research_gaps: ['Scalable error correction beyond NISQ regime.'],
      disclaimer: 'Comparative matrix generated from author-reported abstracts.',
    };

    (global.fetch as jest.Mock) = jest.fn((url: string) => {
      if (url.includes('/api/graph')) {
        return Promise.resolve({ ok: true, json: async () => mockGraphData });
      }
      if (url.includes('/api/papers/compare')) {
        return Promise.resolve({ ok: true, json: async () => mockCompareResponse });
      }
      return Promise.resolve({ ok: true, json: async () => mockPaper1Details });
    });

    render(<GraphPage />);

    await waitFor(() => {
      expect(screen.getByText(/Compare Top 2/i)).toBeInTheDocument();
    });

    const compareBtn = screen.getByText(/Compare Top 2/i);
    await act(async () => {
      fireEvent.click(compareBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Comparative Analysis Matrix')).toBeInTheDocument();
      expect(screen.getByText('2 Papers Compared')).toBeInTheDocument();
    });

    expect(screen.getByText('Evaluate quantum sampling speedups')).toBeInTheDocument();
    expect(screen.getByText('Mitigate gate noise in NISQ')).toBeInTheDocument();
    expect(screen.getByText('Both benchmark superconducting quantum hardware.')).toBeInTheDocument();
  });
});

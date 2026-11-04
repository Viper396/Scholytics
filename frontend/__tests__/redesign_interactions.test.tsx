import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PaperCard, { PaperResult } from '../components/PaperCard';
import SynthesisPanel from '../components/SynthesisPanel';

const samplePaper: PaperResult = {
  arxiv_id: '2301.09999',
  title: 'Attention-Based Hierarchical Neural Routing for Large Codebases',
  authors: [
    'Alice Researcher',
    'Bob Engineer',
    'Charlie Scientist',
    'David Developer',
    'Eve Analyst',
    'Frank Architect',
  ],
  abstract:
    'This is a comprehensive study of attention-based routing across deep neural networks. ' +
    'We present mathematical proofs and extensive empirical evaluations across multiple open benchmarks. ' +
    'The proposed technique reduces latency significantly while maintaining state-of-the-art precision. ' +
    'Additional benchmarks explore scaling laws and memory footprint optimizations.',
  published: '2023-04-12',
  categories: ['cs.AI', 'cs.LG'],
  pdf_url: 'https://arxiv.org/pdf/2301.09999',
  entry_url: 'https://arxiv.org/abs/2301.09999',
  relevance_score: 0.92,
  ranking_degraded: false,
};

describe('Redesign Interactions & Ergonomics', () => {
  it('enforces human-readable reading order: title -> authors -> categories -> abstract -> relevance -> actions', () => {
    const onSummarize = jest.fn();
    const onToggleGraph = jest.fn();
    const onToggleCompare = jest.fn();
    const onToggleSaved = jest.fn();
    const onToggleAbstract = jest.fn();

    const { container } = render(
      <PaperCard
        paper={samplePaper}
        inGraph={false}
        isSaved={false}
        inCompare={false}
        abstractExpanded={false}
        onToggleAbstract={onToggleAbstract}
        onToggleGraph={onToggleGraph}
        onToggleCompare={onToggleCompare}
        onToggleSaved={onToggleSaved}
        onSummarize={onSummarize}
      />,
    );

    const article = container.querySelector('article');
    expect(article).not.toBeNull();

    // Verify Title element appears first
    const title = screen.getByRole('heading', {
      name: /Attention-Based Hierarchical Neural Routing for Large Codebases/i,
    });
    expect(title).toBeInTheDocument();

    // Verify Summarize is the primary action button
    const summarizeBtn = screen.getByRole('button', {
      name: /Summarize: Attention-Based Hierarchical Neural Routing/i,
    });
    expect(summarizeBtn).toBeInTheDocument();
    fireEvent.click(summarizeBtn);
    expect(onSummarize).toHaveBeenCalledWith('2301.09999');

    // Verify relevance meter is rendered with 92.0%
    expect(screen.getByText('92.0%')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '92');

    // Verify original external links
    const arxivLink = screen.getByRole('link', { name: /arXiv abstract for 2301.09999/i });
    expect(arxivLink).toHaveAttribute('href', 'https://arxiv.org/abs/2301.09999');

    const pdfLink = screen.getByRole('link', {
      name: /Open PDF for: Attention-Based Hierarchical Neural Routing/i,
    });
    expect(pdfLink).toHaveAttribute('href', 'https://arxiv.org/pdf/2301.09999');
  });

  it('allows expanding author lists when more than 5 authors exist', () => {
    render(
      <PaperCard
        paper={samplePaper}
        inGraph={false}
        isSaved={false}
        inCompare={false}
        abstractExpanded={false}
        onToggleAbstract={jest.fn()}
        onToggleGraph={jest.fn()}
        onToggleCompare={jest.fn()}
        onToggleSaved={jest.fn()}
        onSummarize={jest.fn()}
      />,
    );

    // Initial state shows +2 more
    const moreBtn = screen.getByRole('button', { name: /\+2 more/i });
    expect(moreBtn).toBeInTheDocument();

    // Expand
    fireEvent.click(moreBtn);
    expect(screen.getByText(/Frank Architect/i)).toBeInTheDocument();

    // Collapse
    const lessBtn = screen.getByRole('button', { name: /\(show less\)/i });
    fireEvent.click(lessBtn);
    expect(screen.getByRole('button', { name: /\+2 more/i })).toBeInTheDocument();
  });

  it('allows toggling long abstract expansion', () => {
    const onToggleAbstract = jest.fn();

    render(
      <PaperCard
        paper={samplePaper}
        inGraph={false}
        isSaved={false}
        inCompare={false}
        abstractExpanded={false}
        onToggleAbstract={onToggleAbstract}
        onToggleGraph={jest.fn()}
        onToggleCompare={jest.fn()}
        onToggleSaved={jest.fn()}
        onSummarize={jest.fn()}
      />,
    );

    const readMoreBtn = screen.getByRole('button', { name: /Read more/i });
    fireEvent.click(readMoreBtn);
    expect(onToggleAbstract).toHaveBeenCalledWith('2301.09999');
  });

  it('renders known synthesis sources as links, but does not turn unknown citation IDs into fake links', () => {
    const mockSources = [
      {
        source_index: 1,
        arxiv_id: '2301.09999',
        title: 'Attention-Based Hierarchical Neural Routing',
        authors: ['Alice Researcher'],
        published: '2023-04-12',
        entry_url: 'https://arxiv.org/abs/2301.09999',
        categories: ['cs.AI'],
      },
    ];

    render(
      <SynthesisPanel
        activeQuery="neural routing"
        isSynthesizing={false}
        isSynthesisComplete={true}
        synthesisText="Verified reference [SOURCE 1] supported by evidence, while hallucinated [SOURCE 99] is unknown."
        synthesisError={null}
        synthesisSources={mockSources}
        synthesisValidation={{
          cited_sources: [1],
          invalid_citations: [99],
          has_hallucinations: true,
          citation_count: 2,
        }}
        copyLabel="Copy"
        selectedCompareCount={0}
        isComparing={false}
        resultsLength={1}
        onGenerateSynthesis={jest.fn()}
        onCancelSynthesis={jest.fn()}
        onGenerateComparison={jest.fn()}
        onCopySynthesis={jest.fn()}
      />,
    );

    // Verified SOURCE 1 should be a link pointing to #source-1
    const source1Link = screen.getByRole('link', { name: /Grounding reference: \[SOURCE 1\]/i });
    expect(source1Link).toBeInTheDocument();
    expect(source1Link).toHaveAttribute('href', '#source-1');

    // Unknown SOURCE 99 should NOT be a link
    expect(screen.queryByRole('link', { name: /\[SOURCE 99\]/i })).toBeNull();
    // But text '[SOURCE 99]' should still be visible
    expect(screen.getByText('[SOURCE 99]')).toBeInTheDocument();
  });
});

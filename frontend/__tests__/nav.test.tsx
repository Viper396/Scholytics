import React from 'react';
import { render, screen } from '@testing-library/react';
import Nav from '../components/Nav';

describe('Nav component', () => {
  it('renders branding and graph link with zero count when no IDs are selected', () => {
    render(<Nav selectedIds={[]} />);
    expect(screen.getByText('Scholytics')).toBeInTheDocument();
    const graphLink = screen.getByRole('link', { name: /graph 0/i });
    expect(graphLink).toHaveAttribute('href', '/graph');
  });

  it('renders graph link with encoded IDs and count when IDs are provided', () => {
    render(<Nav selectedIds={['2301.00001', '2301.00002', '2301.00001']} />);
    const graphLink = screen.getByRole('link', { name: /graph 2/i });
    expect(graphLink).toHaveAttribute('href', '/graph?ids=2301.00001,2301.00002');
  });
});

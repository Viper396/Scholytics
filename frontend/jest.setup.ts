import React from 'react';
import '@testing-library/jest-dom';

// Polyfill TextEncoder and TextDecoder in jsdom
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Polyfill ReadableStream if missing
if (typeof global.ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  global.ReadableStream = ReadableStream;
}

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  value: () => {},
  writable: true,
});

// Mock pure ESM react-markdown
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({
    children,
    components,
  }: {
    children: React.ReactNode;
    components?: Record<string, React.ComponentType<any>>;
  }) {
    if (typeof children === 'string') {
      const paragraphs = children.split(/\n\n+/);
      const renderedParagraphs = paragraphs.map((para, i) => {
        if (components?.p) {
          const PComponent = components.p;
          return React.createElement(PComponent, { key: i, children: para });
        }
        return React.createElement('p', { key: i }, para);
      });
      return React.createElement('div', { 'data-testid': 'markdown' }, renderedParagraphs);
    }
    return React.createElement('div', { 'data-testid': 'markdown' }, children);
  };
});

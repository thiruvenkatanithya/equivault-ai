import { fireEvent, render, screen } from '@testing-library/react';
import axios from 'axios';
import { TextDecoder, TextEncoder } from 'util';
import App from './App';

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

jest.mock('axios');
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));
jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => {},
}));

const sseFrame = event => `data: ${JSON.stringify(event)}\n\n`;

const streamResponse = events => {
  const encoder = new TextEncoder();
  const chunks = events.map(event => encoder.encode(sseFrame(event)));
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }
        ),
      }),
    },
  };
};

test('renders formatted answers and clickable source citations', async () => {
  localStorage.setItem('token', 'test-token');
  axios.get.mockResolvedValue({ data: { username: 'admin_user', role: 'Admin' } });
  global.fetch = jest.fn().mockResolvedValue(streamResponse([
    {
      type: 'token',
      text: '## Summary\n\nMarkets were **mixed** [1].\n\n| Index | Move |\n| --- | --- |\n| S&P 500 | Higher |',
    },
    {
      type: 'done',
      answer: '## Summary\n\nMarkets were **mixed** [1].\n\n| Index | Move |\n| --- | --- |\n| S&P 500 | Higher |',
      sources: [{
        title: 'Market report',
        url: 'https://example.com/markets',
        content: 'A source snippet.',
      }],
      search_used: true,
      status: 'success',
      stock_data: {
        symbol: 'INFY.NS',
        name: 'Infosys Limited',
        exchange: 'NSE',
        currency: 'INR',
        current_price: 1500,
        change_percent: 1.25,
        fifty_two_week_low: 1200,
        fifty_two_week_high: 1800,
        as_of: '2026-10-25T10:00:00+00:00',
        history: [
          { date: '2026-10-20', close: 1480, high: 1490, low: 1470, volume: 100000 },
          { date: '2026-10-21', close: 1500, high: 1510, low: 1475, volume: 120000 },
        ],
      },
      market_data_notice: null,
    },
  ]));

  render(<App />);
  const input = await screen.findByPlaceholderText(/request a web search/i);
  fireEvent.change(input, { target: { value: 'Search the web for stock market updates' } });
  fireEvent.submit(input.closest('form'));

  expect(await screen.findByText(/## Summary/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Market report' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('img', { name: /Infosys Limited closing price over 1M/i })).toBeInTheDocument();
  expect(screen.getByText('52-week range')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: '3M' }));
  expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:8000/chat',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }),
  );
});

test('asks before searching the web when the vault has no relevant answer', async () => {
  localStorage.setItem('token', 'test-token');
  axios.get.mockResolvedValue({ data: { username: 'basic_user', role: 'Basic' } });
  global.fetch = jest.fn()
    .mockResolvedValueOnce(streamResponse([{
      type: 'done',
        answer: 'No relevant information was found. Would you like a web search?',
        sources: [],
        search_used: false,
        needs_web_search: true,
        status: 'needs_web_search',
    }]))
    .mockResolvedValueOnce(streamResponse([{
      type: 'token',
      text: '## Infosys\n\nLatest public information [1].',
    }, {
      type: 'done',
        answer: '## Infosys\n\nLatest public information [1].',
        sources: [{
          title: 'Infosys update',
          url: 'https://example.com/infosys',
          content: 'Current information.',
        }],
        search_used: true,
        needs_web_search: false,
        status: 'success',
    }]));

  render(<App />);
  const input = await screen.findByPlaceholderText(/request a web search/i);
  fireEvent.change(input, { target: { value: 'Infosys stock information' } });
  fireEvent.submit(input.closest('form'));

  fireEvent.click(await screen.findByRole('button', { name: /search the web/i }));

  expect(await screen.findByText(/Latest public information/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    'http://localhost:8000/chat',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'Infosys stock information', user_id: 'basic_user', search_web: true }),
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }),
  );
});

test('does not search the web when the user declines', async () => {
  localStorage.setItem('token', 'test-token');
  axios.get.mockResolvedValue({ data: { username: 'basic_user', role: 'Basic' } });
  global.fetch = jest.fn().mockResolvedValue(streamResponse([{
      type: 'done',
      answer: 'I could not find that in the vault. Would you like a web search?',
      sources: [],
      search_used: false,
      needs_web_search: true,
      status: 'needs_web_search',
  }]));

  render(<App />);
  const input = await screen.findByPlaceholderText(/request a web search/i);
  fireEvent.change(input, { target: { value: 'Infosys stock information' } });
  fireEvent.submit(input.closest('form'));

  fireEvent.click(await screen.findByRole('button', { name: /not now/i }));

  expect(await screen.findByText('No web search was run.')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('renders streamed answer text before the response is complete', async () => {
  localStorage.setItem('token', 'test-token');
  axios.get.mockResolvedValue({ data: { username: 'basic_user', role: 'Basic' } });
  const encoder = new TextEncoder();
  let finishStream;
  const finalEvent = encoder.encode(sseFrame({
    type: 'done',
    answer: 'Completed answer',
    sources: [],
    search_used: false,
    needs_web_search: false,
    status: 'success',
  }));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => {
        const read = jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: encoder.encode(
              sseFrame({ type: 'status', message: 'Writing your answer…' }) +
              sseFrame({ type: 'token', text: 'Visible while streaming' }),
            ),
          })
          .mockImplementationOnce(() => new Promise(resolve => {
            finishStream = () => resolve({ done: false, value: finalEvent });
          }))
          .mockResolvedValueOnce({ done: true, value: undefined });
        return { read };
      },
    },
  });

  render(<App />);
  const input = await screen.findByPlaceholderText(/request a web search/i);
  fireEvent.change(input, { target: { value: 'What is the stock market?' } });
  fireEvent.submit(input.closest('form'));

  expect(await screen.findByText('Visible while streaming')).toBeInTheDocument();
  expect(screen.queryByText('Completed answer')).not.toBeInTheDocument();
  finishStream();
  expect(await screen.findByText('Completed answer')).toBeInTheDocument();
});

test('accepts a JSON response from a backend that has not restarted yet', async () => {
  localStorage.setItem('token', 'test-token');
  axios.get.mockResolvedValue({ data: { username: 'basic_user', role: 'Basic' } });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({
      answer: 'Legacy response',
      sources: [],
      search_used: false,
      needs_web_search: false,
      status: 'success',
    }),
  });

  render(<App />);
  const input = await screen.findByPlaceholderText(/request a web search/i);
  fireEvent.change(input, { target: { value: 'What is the stock market?' } });
  fireEvent.submit(input.closest('form'));

  expect(await screen.findByText('Legacy response')).toBeInTheDocument();
});

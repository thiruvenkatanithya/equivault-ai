import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Globe2,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import Logo from './components/Logo';
import './App.css';

const API_BASE = "http://localhost:8000";

const streamChatResponse = async (payload, token, onEvent) => {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Unable to reach EquiVault. Please try again.');
  }
  if (response.headers?.get('content-type')?.includes('application/json')) {
    const result = await response.json();
    onEvent({
      type: 'done',
      answer: result.answer,
      sources: result.sources || [],
      search_used: result.search_used || false,
      needs_web_search: result.needs_web_search || false,
      stock_data: result.stock_data,
      market_data_notice: result.market_data_notice,
      status: result.status || 'success',
    });
    return;
  }
  if (!response.body?.getReader) {
    throw new Error('This browser cannot read the response stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  const dispatchFrame = (frame) => {
    const data = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;

    const event = JSON.parse(data);
    if (event.type === 'error') throw new Error(event.detail);
    if (event.type === 'done') completed = true;
    onEvent(event);
  };

  while (!completed) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    frames.forEach(dispatchFrame);
    if (done) {
      if (buffer.trim()) dispatchFrame(buffer);
      break;
    }
  }

  if (!completed) throw new Error('The response stream ended before the answer was complete.');
};

const suggestions = [
  'What is the stock market?',
  'Explain the difference between stocks and ETFs',
  'Search the internet for today’s market headlines',
];

const chartRanges = [
  { label: '1M', days: 31 },
  { label: '3M', days: 92 },
  { label: '6M', days: 183 },
  { label: '1Y', days: 366 },
];

const formatPrice = (value, currency) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (!currency) return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
};

const formatCompact = (value, currency) => {
  if (!Number.isFinite(value)) return '';
  if (!currency) return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
  }
};

const StockChart = ({ data }) => {
  const [range, setRange] = useState('1M');
  const selectedRange = chartRanges.find(option => option.label === range) || chartRanges[0];
  const history = useMemo(() => {
    const points = (data.history || []).filter(point => Number.isFinite(Number(point.close)));
    if (points.length < 2) return points;
    const lastDate = new Date(`${points[points.length - 1].date}T00:00:00Z`);
    const startDate = lastDate.getTime() - selectedRange.days * 24 * 60 * 60 * 1000;
    const filtered = points.filter(point => new Date(`${point.date}T00:00:00Z`).getTime() >= startDate);
    return filtered.length >= 2 ? filtered : points.slice(-2);
  }, [data.history, selectedRange.days]);

  const chart = useMemo(() => {
    const width = 760;
    const height = 250;
    const left = 78;
    const right = 14;
    const top = 18;
    const bottom = 24;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const closes = history.map(point => Number(point.close));
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const spread = max - min || Math.abs(max) * 0.02 || 1;
    const paddedMin = min - spread * 0.08;
    const paddedMax = max + spread * 0.08;
    const positions = history.map((point, index) => ({
      ...point,
      x: left + (history.length === 1 ? plotWidth / 2 : (index / (history.length - 1)) * plotWidth),
      y: top + ((paddedMax - Number(point.close)) / (paddedMax - paddedMin)) * plotHeight,
    }));
    const line = positions.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const area = positions.length
      ? `${line} L ${positions[positions.length - 1].x.toFixed(2)} ${(top + plotHeight).toFixed(2)} L ${positions[0].x.toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`
      : '';
    return { width, height, left, right, top, bottom, plotWidth, plotHeight, paddedMin, paddedMax, positions, line, area };
  }, [history]);

  const latest = history[history.length - 1];
  const periodHigh = Math.max(...history.map(point => Number(point.high ?? point.close)));
  const periodLow = Math.min(...history.map(point => Number(point.low ?? point.close)));
  const maxVolume = Math.max(1, ...history.map(point => Number(point.volume) || 0));
  const low52 = Number(data.fifty_two_week_low);
  const high52 = Number(data.fifty_two_week_high);
  const has52WeekRange = Number.isFinite(low52) && Number.isFinite(high52) && high52 > low52;
  const rangePosition = has52WeekRange
    ? Math.min(100, Math.max(0, ((Number(data.current_price) - low52) / (high52 - low52)) * 100))
    : 0;

  return (
    <section className="stock-chart-card" aria-label={`${data.name} stock price chart`}>
      <div className="stock-chart-heading">
        <div className="stock-identity">
          <span className="stock-chart-icon"><BarChart3 size={17} /></span>
          <div>
            <h3>{data.name}</h3>
            <span>{data.symbol}{data.exchange ? ` · ${data.exchange}` : ''}</span>
          </div>
        </div>
        <div className="range-switcher" aria-label="Chart time range">
          {chartRanges.map(option => (
            <button
              key={option.label}
              type="button"
              className={range === option.label ? 'range-active' : ''}
              onClick={() => setRange(option.label)}
              aria-pressed={range === option.label}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stock-price-row">
        <strong>{formatPrice(data.current_price, data.currency)}</strong>
        {data.change_percent != null && (
          <span className={Number(data.change_percent) >= 0 ? 'price-change positive' : 'price-change negative'}>
            {Number(data.change_percent) > 0 ? '+' : ''}{Number(data.change_percent).toFixed(2)}%
          </span>
        )}
        <span className="price-as-of">{latest?.date || ''}{data.currency ? ` · ${data.currency}` : ''}</span>
      </div>

      <div className="stock-chart-scroll">
        <svg
          className="stock-price-chart"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`${data.name} closing price over ${range}`}
        >
          <defs>
            <linearGradient id={`stock-fill-${data.symbol.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#42a876" stopOpacity=".2" />
              <stop offset="100%" stopColor="#42a876" stopOpacity=".01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map(tick => {
            const y = chart.top + (chart.plotHeight * tick) / 3;
            const value = chart.paddedMax - ((chart.paddedMax - chart.paddedMin) * tick) / 3;
            return (
              <g key={tick}>
                <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="chart-grid-line" />
                <text x={chart.left - 9} y={y + 4} textAnchor="end" className="chart-axis-label">
                  {formatCompact(value, data.currency)}
                </text>
              </g>
            );
          })}
          <path d={chart.area} fill={`url(#stock-fill-${data.symbol.replace(/[^a-zA-Z0-9]/g, '')})`} />
          <path d={chart.line} className="chart-price-line" />
          {chart.positions.length > 0 && (
            <circle
              cx={chart.positions[chart.positions.length - 1].x}
              cy={chart.positions[chart.positions.length - 1].y}
              r="4"
              className="chart-current-dot"
            />
          )}
          {[0, Math.floor((history.length - 1) / 2), history.length - 1]
            .filter((index, position, indexes) => indexes.indexOf(index) === position)
            .map((index, position, indexes) => {
              const x = chart.positions[index]?.x ?? chart.left;
              const anchor = position === 0 ? 'start' : position === indexes.length - 1 ? 'end' : 'middle';
              return (
                <text key={`${history[index]?.date}-${index}`} x={x} y={chart.height - 4} textAnchor={anchor} className="chart-axis-label">
                  {history[index]?.date}
                </text>
              );
            })}
        </svg>
      </div>

      <div className="volume-heading"><span>Daily volume</span><span>Trading activity</span></div>
      <div className="stock-volume-scroll">
        <svg className="stock-volume-chart" viewBox={`0 0 ${chart.width} 62`} role="img" aria-label={`${data.name} daily trading volume over ${range}`}>
          {history.map((point, index) => {
            const slot = chart.plotWidth / Math.max(1, history.length);
            const barWidth = Math.max(1, Math.min(7, slot * .64));
            const barHeight = ((Number(point.volume) || 0) / maxVolume) * 48;
            const x = chart.left + index * slot + (slot - barWidth) / 2;
            return (
              <rect
                key={`${point.date}-${index}`}
                x={x}
                y={54 - barHeight}
                width={barWidth}
                height={barHeight}
                rx="1"
                className="volume-bar"
              >
                <title>{`${point.date}: ${Number(point.volume || 0).toLocaleString()} shares`}</title>
              </rect>
            );
          })}
        </svg>
      </div>

      <div className="stock-period-stats">
        <div><span>{range} high</span><strong>{formatPrice(periodHigh, data.currency)}</strong></div>
        <div><span>{range} low</span><strong>{formatPrice(periodLow, data.currency)}</strong></div>
        <div><span>Latest close</span><strong>{formatPrice(latest?.close, data.currency)}</strong></div>
      </div>

      {has52WeekRange && (
        <div className="year-range">
          <div className="year-range-label"><span>52-week range</span><span>{formatPrice(low52, data.currency)} – {formatPrice(high52, data.currency)}</span></div>
          <div className="year-range-track"><span className="year-range-fill" style={{ width: `${rangePosition}%` }} /><i style={{ left: `${rangePosition}%` }} /></div>
        </div>
      )}

      <div className="chart-attribution">
        <span>Historical market data · Yahoo Finance</span>
        {data.as_of && <span>Quote time {new Date(data.as_of).toLocaleString()}</span>}
      </div>
    </section>
  );
};

const MarkdownAnswer = ({ content, sources = [] }) => {
  const markdown = String(content || '').replace(/\[(\d+)\]/g, (citation, number) => {
    const sourceIndex = Number(number) - 1;
    return sources[sourceIndex] ? `[[${number}]](#source-${number})` : citation;
  });

  return (
    <div className="markdown-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = '', children, ...props }) => {
            const citation = href.match(/^#source-(\d+)$/);
            if (citation) {
              const source = sources[Number(citation[1]) - 1];
              return source ? (
                <a href={source.url} target="_blank" rel="noreferrer" className="answer-citation">
                  {children}
                </a>
              ) : <>{children}</>;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="answer-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
};

const App = () => {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Searching your authorized knowledge…');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messageIdRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return undefined;
    }

    let active = true;
    axios.get(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(response => {
        if (active) setUser(response.data);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem('token');
        setToken(null);
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError('');
    try {
      const formData = new FormData();
      formData.append('username', authForm.username);
      formData.append('password', authForm.password);
      const response = await axios.post(`${API_BASE}/token`, formData);
      localStorage.setItem('token', response.data.access_token);
      setToken(response.data.access_token);
    } catch (error) {
      setAuthError(error.response?.data?.detail || 'Unable to sign in. Check your credentials and try again.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setMessages([]);
  };

  const submitQuery = async (query, searchWeb = false, includeUserMessage = true) => {
    if (!query || !user || loading) return;

    if (includeUserMessage) setInput('');
    setLoading(true);
    setLoadingStatus(searchWeb ? 'Searching the web…' : 'Checking your authorized sources…');
    const streamMessageId = `stream-${++messageIdRef.current}`;
    if (includeUserMessage) {
      setMessages(previous => [...previous, { role: 'user', content: query }]);
    }
    setMessages(previous => [...previous, {
      id: streamMessageId,
      role: 'ai',
      content: '',
      streaming: true,
      query,
      sources: [],
    }]);

    try {
      await streamChatResponse({
        message: query,
        user_id: user.username,
        search_web: searchWeb,
      }, token, event => {
        if (event.type === 'status') {
          setLoadingStatus(event.message);
        } else if (event.type === 'token') {
          setLoadingStatus('Writing your answer…');
          setMessages(previous => previous.map(message => (
            message.id === streamMessageId
              ? { ...message, content: message.content + event.text }
              : message
          )));
        } else if (event.type === 'done') {
          setMessages(previous => previous.map(message => (
            message.id === streamMessageId
              ? {
                ...message,
                content: event.answer,
                status: event.status,
                searchUsed: event.search_used,
                needsWebSearch: event.needs_web_search,
                sources: event.sources || [],
                stockData: event.stock_data,
                marketDataNotice: event.market_data_notice,
                streaming: false,
              }
              : message
          )));
        }
      });
    } catch (error) {
      const detail = error.message || 'Unable to reach EquiVault. Please try again.';
      setMessages(previous => previous.map(message => (
        message.id === streamMessageId
          ? { ...message, role: 'error', content: detail, streaming: false }
          : message
      )));
    } finally {
      setLoading(false);
      setLoadingStatus('Searching your authorized knowledge…');
      inputRef.current?.focus();
    }
  };

  const sendMessage = (event) => {
    event?.preventDefault();
    submitQuery(input.trim());
  };

  const answerWebSearchPrompt = (messageIndex, accepted) => {
    const message = messages[messageIndex];
    if (!message?.needsWebSearch) return;

    setMessages(previous => previous.map((item, index) => (
      index === messageIndex
        ? { ...item, needsWebSearch: false, webSearchDeclined: !accepted }
        : item
    )));
    if (accepted) submitQuery(message.query, true, false);
  };

  const startSuggestion = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  if (!token) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="login-brand">
            <span className="brand-mark"><Logo className="brand-logo" /></span>
            <span>EquiVault <b>AI</b></span>
          </div>
          <div className="login-heading">
            <span className="eyebrow">Private financial knowledge</span>
            <h1>Your research,<br />all in one place.</h1>
            <p>Sign in to search your authorized knowledge vault and get clear, source-backed answers.</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              value={authForm.username}
              onChange={event => setAuthForm({ ...authForm, username: event.target.value })}
              placeholder="Enter your username"
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={authForm.password}
              onChange={event => setAuthForm({ ...authForm, password: event.target.value })}
              placeholder="Enter your password"
              required
            />
            {authError && <p className="form-error" role="alert">{authError}</p>}
            <button className="login-button" type="submit">Sign in to EquiVault <ChevronRight size={17} /></button>
          </form>
          <p className="login-note"><ShieldCheck size={14} /> Your access is protected by role-based permissions.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="EquiVault home">
          <span className="brand-mark"><Logo className="brand-logo" /></span>
          <span className="brand-name">EquiVault<span>AI</span></span>
        </a>

        <div className="sidebar-section-label">Workspace</div>
        <button className="nav-item nav-item-active" type="button">
          <Search size={17} /> Knowledge search
        </button>

        <div className="sidebar-section-label vault-label">Your knowledge vault</div>
        <div className="nav-item nav-item-static"><BookOpen size={17} /> Basic guides <Check className="nav-check" size={15} /></div>
        {user?.role !== 'Basic' && <div className="nav-item nav-item-static"><FileText size={17} /> Premium strategies <Check className="nav-check" size={15} /></div>}
        {user?.role === 'Admin' && <div className="nav-item nav-item-static"><ShieldCheck size={17} /> Admin master vault <Check className="nav-check" size={15} /></div>}

        <div className="sidebar-spacer" />
        <div className="access-note">
          <ShieldCheck size={16} />
          <div><b>Role-protected access</b><span>Results respect your vault permissions.</span></div>
        </div>
        <div className="profile-card">
          <span className="profile-avatar"><UserRound size={18} /></span>
          <span className="profile-info"><b>{user?.username || 'Loading profile'}</b><small>{user?.role || 'User'} access</small></span>
          <button className="logout-button" type="button" onClick={handleLogout} aria-label="Log out" title="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-title">
            <span className="mobile-brand-mark"><Logo className="brand-logo" /></span>
            <div><span className="eyebrow">EquiVault workspace</span><h1>Knowledge search</h1></div>
          </div>
          <div className="connection-status"><span className="status-dot" /> AI agent online</div>
        </header>

        <div className={`conversation ${messages.length === 0 ? 'conversation-empty' : ''}`}>
          {messages.length === 0 ? (
            <div className="welcome">
              <span className="welcome-icon"><Sparkles size={21} /></span>
              <span className="eyebrow">Your private research assistant</span>
              <h2>What would you like<br />to understand today?</h2>
              <p>Ask a question about investing concepts or request current information from the web.</p>
              <div className="suggestions">
                {suggestions.map(suggestion => (
                  <button key={suggestion} type="button" onClick={() => startSuggestion(suggestion)}>
                    <span>{suggestion}</span><ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => message.role === 'user' ? (
                <article className="user-message" key={`user-${index}`}>
                  <span className="message-avatar user-avatar"><UserRound size={16} /></span>
                  <div className="user-message-content"><span className="message-label">You</span><p>{message.content}</p></div>
                </article>
              ) : (
                <article className={`answer-card ${message.role === 'error' ? 'answer-error' : ''}`} key={`answer-${index}`}>
                  <div className="answer-heading">
                    <span className="message-avatar ai-avatar">{message.searchUsed ? <Globe2 size={16} /> : message.role === 'error' ? <CircleHelp size={16} /> : <Bot size={16} />}</span>
                    <div className="answer-heading-copy">
                      <span className="message-label">{message.role === 'error' ? 'Connection issue' : message.searchUsed ? 'Web research' : 'Vault analysis'}</span>
                      <small>{message.searchUsed ? 'Current web results' : 'EquiVault knowledge assistant'}</small>
                    </div>
                    {message.status === 'pending_human' && <span className="pending-badge">Pending review</span>}
                    {message.streaming && <span className="pending-badge">Streaming</span>}
                  </div>
                  <MarkdownAnswer content={message.content} sources={message.sources} />
                  {message.stockData && <StockChart data={message.stockData} />}
                  {message.marketDataNotice && (
                    <p className="market-data-notice">{message.marketDataNotice}</p>
                  )}
                  {message.needsWebSearch && (
                    <div className="web-search-confirmation">
                      <span>Would you like to search the web for this instead?</span>
                      <div>
                        <button
                          type="button"
                          className="web-search-accept"
                          disabled={loading}
                          onClick={() => answerWebSearchPrompt(index, true)}
                        >
                          <Globe2 size={15} /> Search the web
                        </button>
                        <button
                          type="button"
                          className="web-search-decline"
                          onClick={() => answerWebSearchPrompt(index, false)}
                        >
                          Not now
                        </button>
                      </div>
                    </div>
                  )}
                  {message.webSearchDeclined && (
                    <p className="web-search-declined">No web search was run.</p>
                  )}
                  {message.sources?.length > 0 && (
                    <section className="sources-panel" aria-label="Sources">
                      <div className="sources-title"><Globe2 size={15} /><span>Sources</span><span className="sources-count">{message.sources.length}</span></div>
                      <ol>
                        {message.sources.map((source, sourceIndex) => (
                          <li id={`source-${sourceIndex + 1}`} key={`${source.url}-${sourceIndex}`}>
                            <span className="source-number">{sourceIndex + 1}</span>
                            <div className="source-copy">
                              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              {(source.publisher || source.published_at) && (
                                <span className="source-meta">
                                  {[source.publisher, source.published_at && new Date(source.published_at).toLocaleDateString()]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                              {source.content && <p>{source.content}</p>}
                            </div>
                            <a className="source-open" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`}><ChevronRight size={16} /></a>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {message.role === 'ai' && (
                    <div className="answer-disclaimer"><ShieldCheck size={14} /> For education only—not personalized financial advice.</div>
                  )}
                </article>
              ))}
              {loading && (
                <div className="loading-answer" role="status">
                  <span className="loading-spinner" />
                  <span>{loadingStatus}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <footer className="composer-area">
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(event);
                }
              }}
              placeholder="Ask a question or request a web search…"
              aria-label="Ask EquiVault"
              rows={1}
              disabled={!user || loading}
            />
            <button className="send-button" type="submit" disabled={!input.trim() || !user || loading} aria-label="Send message">
              <ArrowUp size={19} />
            </button>
          </form>
          <div className="composer-hint"><span><kbd>Enter</kbd> to send <kbd>Shift + Enter</kbd> for a new line</span><span>Responses may contain errors. Verify important details.</span></div>
        </footer>
      </section>
    </main>
  );
};

export default App;

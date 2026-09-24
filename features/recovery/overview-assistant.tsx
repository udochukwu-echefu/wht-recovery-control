"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowRight,
  Copy,
  FileText,
  FilePlus2,
  History,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Tag,
  UserRoundPlus,
  X,
} from "lucide-react";
import { formatNaira } from "./presentation";
import { consumeChatStream, type ChatStreamEvent } from "@/lib/ai/chat-stream";
import type { AppMode, CaseFilter, RecoveryCase } from "./types";

type AssistantAnswer = {
  text: string;
  action?: { label: string; caseId?: string; filter?: CaseFilter };
  title?: string;
  sourceLabels?: string[];
  limitations?: string[];
  suggestedAction?: string;
};

type ChatActivity = { id: string; label: string; state: "running" | "complete"; detail?: string; kind: "status" | "tool" };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Omit<AssistantAnswer, "text"> & { attachmentName?: string; aiJobId?: string; activity?: ChatActivity[] };
  state?: "thinking" | "streaming" | "done" | "error";
  activity?: ChatActivity[];
  error?: string;
};

type Conversation = { id: string; title: string; updatedAt: string };

type SpeechRecognizer = {
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function answerQuestion(question: string, cases: RecoveryCase[]): AssistantAnswer {
  const query = question.toLowerCase();
  const active = cases.filter((item) => item.stage !== "closed");
  const intervention = active.filter(
    (item) => item.stage === "evidence-needed" || item.stage === "in-dispute",
  );
  const missing = active.filter((item) => item.stage === "evidence-needed");
  const matchedCase = cases.find((item) =>
    query.includes(item.customer.toLowerCase()),
  );

  if (matchedCase) {
    return {
      text: `${matchedCase.customer} has ${formatNaira(matchedCase.amount)} in expected WHT. Its current status is ${matchedCase.stage.replaceAll("-", " ")}, and the next action is: ${matchedCase.nextAction}`,
      action: { label: `Open ${matchedCase.customer}`, caseId: matchedCase.id },
    };
  }
  if (/evidence|receipt|document|missing/.test(query)) {
    return {
      text: missing.length
        ? `${missing.length} ${missing.length === 1 ? "case needs" : "cases need"} evidence: ${missing.map((item) => `${item.customer} (${formatNaira(item.amount)})`).join(", ")}. Open a case to review the exact outstanding documents and checks.`
        : "No current cases are in the evidence-needed stage. Open the queue to inspect individual evidence checks.",
      action: { label: "View evidence cases", filter: "evidence-needed" },
    };
  }
  if (/coverage|recognis|recognized|matched|graph/.test(query)) {
    const recognised = cases.filter(
      (item) => item.stage === "recognised" || item.stage === "closed",
    );
    return {
      text: `${recognised.length} ${recognised.length === 1 ? "case is" : "cases are"} recognised or closed, worth ${formatNaira(recognised.reduce((sum, item) => sum + item.amount, 0))}. ${intervention.length} ${intervention.length === 1 ? "case still needs" : "cases still need"} intervention. The coverage panel below breaks down the remaining value by stage.`,
      action: { label: "View all cases" },
    };
  }
  if (/attention|priority|urgent|risk|exception|first|briefing|summary/.test(query)) {
    const top = intervention.toSorted(
      (a, b) => b.amount * Math.max(b.age, 1) - a.amount * Math.max(a.age, 1),
    )[0];
    return {
      text: top
        ? `${intervention.length} ${intervention.length === 1 ? "case requires" : "cases require"} intervention, totalling ${formatNaira(intervention.reduce((sum, item) => sum + item.amount, 0))}. ${top.customer} leads the queue at ${formatNaira(top.amount)} and ${top.age} days open. Its next action is: ${top.nextAction}`
        : "No current cases require intervention. The recovery queue below shows the active portfolio.",
      action: top
        ? { label: `Open ${top.customer}`, caseId: top.id }
        : { label: "View all cases" },
    };
  }
  return {
    text: `I can explain the current ${active.length} active cases, evidence gaps, recognised value, and which exceptions need attention. Ask about a customer by name for its status and next action.`,
    action: { label: "View all cases" },
  };
}

export function OverviewAssistant({
  mode,
  profileName,
  cases,
  onOpenCase,
  onViewCases,
  onFilterCases,
}: {
  mode: AppMode;
  profileName: string;
  cases: RecoveryCase[];
  onOpenCase: (id: string) => void;
  onViewCases: () => void;
  onFilterCases: (filter: CaseFilter) => void;
}) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(mode === "live");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognizer | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const firstName = profileName.trim().split(/\s+/)[0] || "there";

  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    void fetch("/api/assistant/conversations")
      .then(async (response) => {
        const result = await response.json() as { error?: string; conversations?: Conversation[]; activeId?: string | null; messages?: ChatMessage[] };
        if (!response.ok) throw new Error(result.error || "Conversation history could not be loaded.");
        if (cancelled) return;
        setConversations(result.conversations ?? []);
        setActiveConversationId(result.activeId ?? null);
        setMessages(result.messages ?? []);
      })
      .catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Conversation history could not be loaded."); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [mode]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages, busy]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const caretAtEnd = input.selectionEnd === input.value.length;
    input.style.height = "auto";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(contentHeight, 180)}px`;
    input.style.overflowY = contentHeight > 180 ? "auto" : "hidden";
    if (contentHeight > 180 && caretAtEnd) input.scrollTop = contentHeight;
  }, [question]);

  const selectAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(txt|csv)$/i.test(file.name) || file.size < 1 || file.size > 65_536) {
      setError("Attach a TXT or CSV file no larger than 64 KB. PDFs and images belong in Data intake.");
      return;
    }
    setAttachment(file);
    setError("");
  };

  const loadConversation = async (id?: string) => {
    const response = await fetch(`/api/assistant/conversations${id ? `?id=${encodeURIComponent(id)}` : ""}`);
    const result = await response.json() as { error?: string; conversations?: Conversation[]; activeId?: string | null; messages?: ChatMessage[] };
    if (!response.ok) throw new Error(result.error || "Conversation history could not be loaded.");
    setConversations(result.conversations ?? []);
    setActiveConversationId(result.activeId ?? null);
    setMessages(result.messages ?? []);
    return result;
  };

  const newConversation = async () => {
    if (busy || loadingHistory) return;
    setError("");
    if (mode === "demo") {
      setMessages([]);
      setQuestion("");
      setAttachment(null);
      setHistoryOpen(false);
      inputRef.current?.focus();
      return;
    }
    try {
      const response = await fetch("/api/assistant/conversations", { method: "POST" });
      const result = await response.json() as Conversation & { error?: string };
      if (!response.ok) throw new Error(result.error || "A new conversation could not be started.");
      setActiveConversationId(result.id);
      setConversations((current) => [result, ...current].slice(0, 20));
      setMessages([]);
      setQuestion("");
      setAttachment(null);
      setHistoryOpen(false);
      inputRef.current?.focus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "A new conversation could not be started.");
    }
  };

  const send = async (value = question, action: "ask" | "briefing" = "ask") => {
    if (busy || loadingHistory) return;
    const selectedFile = attachment;
    const prompt = value.trim() || (selectedFile ? `Summarise ${selectedFile.name} in the context of this portfolio.` : "");
    if (action === "ask" && !prompt) return;
    const userText = action === "briefing" ? "Create a portfolio briefing" : prompt;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const userMessage: ChatMessage = { id: userId, role: "user", content: userText, metadata: { attachmentName: selectedFile?.name }, state: "done" };
    const pendingMessage: ChatMessage = { id: assistantId, role: "assistant", content: "", metadata: {}, state: "thinking", activity: [{ id: "request", kind: "status", label: "Starting request", state: "running" }] };
    setMessages((current) => [...current, userMessage, pendingMessage]);
    if (messages.length === 0) requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "start" }));
    setQuestion("");
    setAttachment(null);
    setBusy(true);
    setError("");
    setHistoryOpen(false);
    const updateAssistant = (update: (message: ChatMessage) => ChatMessage) => setMessages((current) => current.map((message) => message.id === assistantId ? update(message) : message));
    try {
      if (mode === "demo") {
        updateAssistant((message) => ({ ...message, activity: [{ id: "demo-portfolio", kind: "tool", label: "Load synthetic portfolio", state: "running" }] }));
        await new Promise((resolve) => setTimeout(resolve, 120));
        const result = answerQuestion(action === "briefing" ? "Which exceptions need attention for a portfolio briefing?" : prompt, cases);
        if (selectedFile) {
          const text = (await selectedFile.text()).trim();
          const excerpt = text.slice(0, 280);
          result.text += ` Attached ${selectedFile.name} contains readable text beginning “${excerpt}${text.length > 280 ? "…" : ""}”. This local preview is not added to the case records.`;
        }
        updateAssistant((message) => ({ ...message, state: "streaming", activity: [{ id: "demo-portfolio", kind: "tool", label: "Load synthetic portfolio", state: "complete", detail: `${cases.length} cases` }] }));
        for (let offset = 0; offset < result.text.length; offset += 80) {
          const chunk = result.text.slice(offset, offset + 80);
          updateAssistant((message) => ({ ...message, content: message.content + chunk }));
          await new Promise((resolve) => setTimeout(resolve, 14));
        }
        updateAssistant((message) => ({ ...message, metadata: { ...result, title: action === "briefing" ? "Portfolio briefing draft" : undefined, sourceLabels: ["Synthetic portfolio", ...(selectedFile ? ["Local text attachment"] : [])] }, state: "done" }));
      } else {
        let id = activeConversationId;
        if (!id) {
          const response = await fetch("/api/assistant/conversations", { method: "POST" });
          const created = await response.json() as Conversation & { error?: string };
          if (!response.ok) throw new Error(created.error || "A new conversation could not be started.");
          id = created.id;
          setActiveConversationId(id);
          setConversations((current) => [created, ...current].slice(0, 20));
        }
        const form = new FormData();
        form.set("conversationId", id);
        form.set("action", action);
        form.set("question", prompt);
        if (selectedFile) form.set("file", selectedFile);
        const response = await fetch("/api/assistant/chat", { method: "POST", body: form });
        await consumeChatStream(response, (event: ChatStreamEvent) => {
          if (event.type === "status") updateAssistant((message) => ({ ...message, state: "thinking", activity: [...(message.activity ?? []).filter((item) => item.id !== "request" && item.id !== event.phase).map((item) => item.kind === "status" && item.state === "running" ? { ...item, state: "complete" as const } : item), { id: event.phase, kind: "status", label: event.label, state: "running" }] }));
          if (event.type === "tool") updateAssistant((message) => ({ ...message, activity: [...(message.activity ?? []).filter((item) => item.id !== "request" && item.id !== event.id), { id: event.id, kind: "tool", label: event.label, state: event.state, detail: event.detail }] }));
          if (event.type === "answer_start") updateAssistant((message) => ({ ...message, state: "streaming", activity: (message.activity ?? []).map((item) => item.state === "running" ? { ...item, state: "complete" } : item) }));
          if (event.type === "answer_delta") updateAssistant((message) => ({ ...message, content: message.content + event.text, state: "streaming" }));
          if (event.type === "done") {
            updateAssistant((message) => ({ ...message, state: "done", metadata: event.metadata as ChatMessage["metadata"], activity: (event.metadata.activity as ChatMessage["activity"]) ?? message.activity }));
            setConversations((current) => current.map((item) => item.id === id ? { ...item, title: event.conversationTitle, updatedAt: new Date().toISOString() } : item).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          }
        });
      }
      inputRef.current?.focus();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The assistant could not complete this request.";
      updateAssistant((current) => ({ ...current, state: "error", error: message, activity: (current.activity ?? []).map((item) => item.state === "running" ? { ...item, state: "complete" } : item) }));
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const startVoiceInput = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not available in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setQuestion((current) => `${current.trim()}${current.trim() ? " " : ""}${transcript}`.slice(0, 300));
      inputRef.current?.focus();
      setError("");
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Voice input could not be started. Check microphone access or type your question.");
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try {
      recognition.start();
      setListening(true);
      setError("");
    } catch {
      setListening(false);
      setError("Voice input could not be started. Type your question instead.");
    }
  };

  const copyAnswer = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(`${message.metadata.title ? `${message.metadata.title}\n\n` : ""}${message.content}`);
      setCopiedId(message.id);
    } catch {
      setError("Copying is unavailable in this browser. Select the answer text to copy it.");
    }
  };

  const switchConversation = async (id: string) => {
    if (busy || loadingHistory || id === activeConversationId) { setHistoryOpen(false); return; }
    setLoadingHistory(true);
    setError("");
    try {
      await loadConversation(id);
      setHistoryOpen(false);
      setQuestion("");
      setAttachment(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Conversation history could not be loaded.");
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <section ref={sectionRef} className={`overview-assistant${messages.length ? " has-messages" : ""}`} aria-label="Portfolio assistant">
      <header className="overview-chat-header">
        <span className="overview-chat-title"><span className="overview-chat-mark"><Sparkles size={16} /></span> Portfolio assistant</span>
        <div className="overview-chat-header-actions">
          {mode === "live" && <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} disabled={busy || loadingHistory}><History size={16} /> History</button>}
          <button type="button" onClick={() => void newConversation()} disabled={busy || loadingHistory}><Plus size={16} /> New chat</button>
        </div>
      </header>
      {historyOpen && (
        <div className="overview-chat-history" aria-label="Recent conversations">
          {conversations.length ? conversations.map((item) => (
            <button type="button" key={item.id} className={item.id === activeConversationId ? "active" : ""} onClick={() => void switchConversation(item.id)}>{item.title}</button>
          )) : <p>No previous conversations.</p>}
        </div>
      )}
      <div className="overview-assistant-body">
        {loadingHistory ? <div className="overview-chat-loading"><LoaderCircle className="overview-assistant-spinner" size={19} /> Loading conversation…</div> : messages.length === 0 ? (
          <div className="overview-chat-empty">
            <div className="overview-assistant-orb" aria-hidden="true" />
            <h2>Welcome, {firstName}<br />What can I help with today?</h2>
            <div className="overview-assistant-shortcuts" aria-label="Quick actions">
              <button type="button" disabled={busy} onClick={() => void send("Which cases need my attention?")}><Tag size={18} /> Review exceptions</button>
              <button type="button" disabled={busy} onClick={() => void send("Explain evidence coverage")}><FileText size={18} /> Explain coverage</button>
              <button type="button" onClick={onViewCases}><UserRoundPlus size={19} /> Open case queue</button>
            </div>
            <p className="overview-assistant-eyebrow">Ask about what we found</p>
            <div className="overview-assistant-suggestions">
              {["Which cases need my attention?", "Where is evidence still missing?"].map((suggestion) => (
                <button key={suggestion} type="button" disabled={busy} onClick={() => void send(suggestion)}><Sparkles size={18} /><span>{suggestion}</span><ArrowRight size={18} /></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="overview-chat-transcript" ref={transcriptRef} role="log" aria-live="polite" aria-label="Conversation" aria-busy={busy}>
            {messages.map((message) => (
              <article key={message.id} className={`overview-chat-message ${message.role}`}>
                {message.role === "assistant" && <span className="overview-chat-avatar" aria-hidden="true"><Sparkles size={16} /></span>}
                <div className="overview-chat-bubble">
                  <div className="overview-chat-message-top"><strong>{message.role === "user" ? "You" : "Portfolio assistant"}</strong>{message.role === "assistant" && <span className={`overview-chat-state ${message.state ?? "done"}`}>{message.state === "thinking" ? "Working" : message.state === "streaming" ? "Streaming" : message.state === "error" ? "Needs attention" : "Complete"}</span>}</div>
                  {message.role === "user" && message.metadata.attachmentName && <span className="overview-chat-file"><Paperclip size={13} /> {message.metadata.attachmentName}</span>}
                  {message.role === "assistant" && (message.activity ?? message.metadata.activity)?.length ? (
                    <div className="overview-chat-activity" aria-label="Assistant activity">
                      {(message.activity ?? message.metadata.activity ?? []).map((item, index) => <div key={`${item.id}-${index}`} className={`overview-chat-activity-row ${item.state}`}>
                        {item.state === "running" ? <LoaderCircle size={14} className="overview-assistant-spinner" /> : item.kind === "tool" ? <FileText size={14} /> : <Sparkles size={14} />}
                        <span>{item.label}</span>{item.detail && <small>{item.detail}</small>}
                      </div>)}
                    </div>
                  ) : null}
                  {message.metadata.title && <h3>{message.metadata.title}</h3>}
                  {message.content && <p className="overview-chat-content">{message.content}{message.state === "streaming" && <span className="overview-chat-cursor" aria-hidden="true" />}</p>}
                  {message.state === "error" && <p className="overview-chat-message-error">{message.error}</p>}
                  {message.role === "assistant" && message.state !== "thinking" && message.state !== "error" && message.state !== "streaming" && (
                    <>
                      {message.metadata.sourceLabels?.length ? <small className="overview-chat-sources">Sources: {message.metadata.sourceLabels.join(", ")}</small> : null}
                      {message.metadata.limitations?.filter(Boolean).map((item) => <small className="overview-chat-limitation" key={item}>Limit: {item}</small>)}
                      {message.metadata.suggestedAction && <small className="overview-chat-limitation">Suggested next step: {message.metadata.suggestedAction}</small>}
                      <div className="overview-chat-message-actions">
                        <button type="button" onClick={() => void copyAnswer(message)}><Copy size={14} /> {copiedId === message.id ? "Copied" : "Copy"}</button>
                        {message.metadata.action && <button type="button" onClick={() => message.metadata.action?.caseId ? onOpenCase(message.metadata.action.caseId) : message.metadata.action?.filter ? onFilterCases(message.metadata.action.filter) : onViewCases()}>{message.metadata.action.label} <ArrowRight size={14} /></button>}
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <form className="overview-assistant-composer" onSubmit={submit}>
          <input ref={fileRef} className="sr-only" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={selectAttachment} tabIndex={-1} aria-label="Choose a text attachment" />
          <label className="sr-only" htmlFor="overview-assistant-question">
            Ask about the current portfolio
          </label>
          <textarea
            id="overview-assistant-question"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={keyDown}
            maxLength={300}
            rows={1}
            placeholder="Ask me anything"
            disabled={busy || loadingHistory}
          />
          <button
            className="overview-assistant-send"
            type="submit"
            aria-label="Ask question"
            disabled={busy || loadingHistory || (!question.trim() && !attachment)}
          >
            {busy ? <LoaderCircle size={20} className="overview-assistant-spinner" /> : <Send size={21} />}
          </button>
          {attachment && (
            <div className="overview-assistant-attachment">
              <FileText size={15} /> <span>{attachment.name}</span>
              <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachment(null)} disabled={busy}><X size={14} /></button>
            </div>
          )}
          <div className="overview-assistant-composer-footer">
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || loadingHistory} title="Attach a TXT or CSV file up to 64 KB">
                <Paperclip size={17} /> Attach
              </button>
              <button type="button" onClick={() => void send("Create a portfolio briefing", "briefing")} disabled={busy || loadingHistory}>
                <FilePlus2 size={17} /> Create
              </button>
              <button type="button" onClick={startVoiceInput} aria-label={listening ? "Stop voice input" : "Use voice input"} aria-pressed={listening} disabled={busy || loadingHistory}>
                <Mic size={18} />
              </button>
            </div>
            <span>{question.length}/300</span>
          </div>
        </form>
        {error && <p className="overview-assistant-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

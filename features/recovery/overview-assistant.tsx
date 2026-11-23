"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  FileText,
  History,
  LoaderCircle,
  Mic,
  Paperclip,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import { formatNaira } from "./presentation";
import { ActionProposalCard } from "./action-proposal";
import type { ActionProposalPreview } from "@/lib/ai/action-contracts";
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
type ChatProposal = ActionProposalPreview;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Omit<AssistantAnswer, "text"> & { attachmentName?: string; aiJobId?: string; activity?: ChatActivity[]; proposal?: ChatProposal; backgroundRun?: { id: string; status: "queued" | "running" | "completed" | "failed" | "canceled"; scheduledFor?: string; phase?: string } };
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
      text: `${recognised.length} ${recognised.length === 1 ? "case is" : "cases are"} recognised or closed, worth ${formatNaira(recognised.reduce((sum, item) => sum + item.amount, 0))}. ${intervention.length} ${intervention.length === 1 ? "case still needs" : "cases still need"} intervention. Open Recovery overview for the evidence coverage breakdown.`,
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
        : "No current cases require intervention. Open the recovery queue to inspect the active portfolio.",
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
  open,
  onClose,
  mode,
  canReviewProposals,
  cases,
  onOpenCase,
  onViewCases,
  onFilterCases,
  onActionApplied,
}: {
  open: boolean;
  onClose: () => void;
  mode: AppMode;
  canReviewProposals: boolean;
  cases: RecoveryCase[];
  onOpenCase: (id: string) => void;
  onViewCases: () => void;
  onFilterCases: (filter: CaseFilter) => void;
  onActionApplied?: () => void;
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
  const hasRunningInvestigation = messages.some((message) => message.metadata.backgroundRun?.status === "queued" || message.metadata.backgroundRun?.status === "running");
  const onlyWaitingFollowups = hasRunningInvestigation && messages.filter((message) => message.metadata.backgroundRun?.status === "queued" || message.metadata.backgroundRun?.status === "running").every((message) => message.metadata.backgroundRun?.status === "queued" && Boolean(message.metadata.backgroundRun.scheduledFor));

  useEffect(() => () => recognitionRef.current?.stop(), []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyOpen) setHistoryOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, historyOpen, onClose]);

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

  useEffect(() => {
    if (mode !== "live" || !activeConversationId || !hasRunningInvestigation || busy) return;
    let canceled = false;
    const timer = window.setInterval(() => {
      void fetch(`/api/assistant/conversations?id=${encodeURIComponent(activeConversationId)}`)
        .then(async (response) => {
          const result = await response.json() as { messages?: ChatMessage[]; conversations?: Conversation[] };
          if (response.ok && !canceled) {
            setMessages(result.messages ?? []);
            setConversations(result.conversations ?? []);
          }
        })
        .catch(() => { /* The next poll can resume progress after a transient network error. */ });
    }, onlyWaitingFollowups ? 30_000 : 2_000);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [mode, activeConversationId, hasRunningInvestigation, onlyWaitingFollowups, busy]);

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

  const cancelInvestigation = async (runId: string) => {
    try {
      const response = await fetch("/api/assistant/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The investigation could not be canceled.");
      setMessages((current) => current.map((message) => message.metadata.backgroundRun?.id === runId
        ? { ...message, state: "error", error: "Investigation canceled.", metadata: { ...message.metadata, backgroundRun: { id: runId, status: "canceled" } } }
        : message));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The investigation could not be canceled."); }
  };

  const startBackgroundInvestigation = async () => {
    const prompt = question.trim();
    if (busy || loadingHistory || mode !== "live" || attachment || !prompt) return;
    setBusy(true);
    setError("");
    try {
      let id = activeConversationId;
      if (!id) {
        const response = await fetch("/api/assistant/conversations", { method: "POST" });
        const created = await response.json() as Conversation & { error?: string };
        if (!response.ok) throw new Error(created.error || "A new conversation could not be started.");
        id = created.id;
        setActiveConversationId(id);
        setConversations((current) => [created, ...current].slice(0, 20));
      }
      const response = await fetch("/api/assistant/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, question: prompt }) });
      const result = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !result.runId) throw new Error(result.error || "The investigation could not be started.");
      setMessages((current) => [...current,
        { id: crypto.randomUUID(), role: "user", content: prompt, metadata: {}, state: "done" },
        { id: crypto.randomUUID(), role: "assistant", content: "", metadata: { backgroundRun: { id: result.runId!, status: "queued" } }, state: "thinking", activity: [{ id: "queued", kind: "status", label: "Investigation queued", state: "running" }] },
      ]);
      setQuestion("");
      setHistoryOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The investigation could not be started."); }
    finally { setBusy(false); }
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

  const stateLabel = (message: ChatMessage) =>
    message.metadata.backgroundRun && message.state === "thinking"
      ? "Running in the background"
      : message.state === "thinking"
        ? "Working"
        : message.state === "streaming"
          ? "Writing"
          : null;

  return (
    <aside
      id="assistant-panel"
      className={`assistant-panel${open ? " open" : ""}`}
      aria-label="Portfolio assistant"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="assistant-panel-header">
        <div className="assistant-panel-title">
          <h2>Assistant</h2>
          <p>{mode === "demo" ? "Answers from the demo portfolio" : "Answers from your case records"}</p>
        </div>
        <div className="assistant-header-actions">
          {mode === "live" && <button type="button" className="icon-button" aria-label="Conversation history" title="Conversation history" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} disabled={busy || loadingHistory}><History size={17} /></button>}
          <button type="button" className="icon-button" aria-label="New chat" title="New chat" onClick={() => void newConversation()} disabled={busy || loadingHistory}><SquarePen size={16} /></button>
          <button type="button" className="icon-button" aria-label="Close assistant" title="Close (Esc)" onClick={onClose}><X size={18} /></button>
        </div>
      </header>
      {historyOpen && (
        <div className="overview-chat-history" aria-label="Recent conversations">
          {conversations.length ? conversations.map((item) => (
            <button type="button" key={item.id} className={item.id === activeConversationId ? "active" : ""} onClick={() => void switchConversation(item.id)}>{item.title}</button>
          )) : <p>No previous conversations.</p>}
        </div>
      )}
      <div className="assistant-body">
        {loadingHistory ? (
          <div className="assistant-loading"><LoaderCircle className="overview-assistant-spinner" size={18} /> Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="assistant-chat-empty">
            <p className="assistant-chat-empty-lead">Ask about cases, evidence gaps or recognised value. Answers name the records they use, and nothing changes without reviewer approval.</p>
            <p className="assistant-chat-empty-label">Try asking</p>
            <div className="assistant-suggestions">
              {["Which cases need my attention?", "Where is evidence still missing?", "Explain evidence coverage"].map((suggestion) => (
                <button key={suggestion} type="button" disabled={busy} onClick={() => void send(suggestion)}><span>{suggestion}</span><ArrowRight size={15} aria-hidden="true" /></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="assistant-transcript" ref={transcriptRef} role="log" aria-live="polite" aria-label="Conversation" aria-busy={busy}>
            {messages.map((message) => {
              if (message.role === "user") return (
                <article key={message.id} className="assistant-msg user" aria-label="Your question">
                  <div className="assistant-user-bubble">
                    {message.metadata.attachmentName && <span className="assistant-file-chip"><Paperclip size={12} /> {message.metadata.attachmentName}</span>}
                    {message.content}
                  </div>
                </article>
              );
              const steps = message.activity ?? message.metadata.activity ?? [];
              const status = stateLabel(message);
              const settled = message.state !== "thinking" && message.state !== "error" && message.state !== "streaming";
              return (
                <article key={message.id} className="assistant-msg assistant" aria-label="Assistant answer">
                  {status && <p className="assistant-status"><LoaderCircle size={13} className="overview-assistant-spinner" /> {status}</p>}
                  {steps.length > 0 && (
                    <ol className="assistant-steps" aria-label="Steps taken">
                      {steps.map((item, index) => (
                        <li key={`${item.id}-${index}`} className={item.state}>
                          {item.state === "running" ? <LoaderCircle size={13} className="overview-assistant-spinner" /> : <Check size={13} />}
                          <span>{item.label}</span>
                          {item.detail && <small>{item.detail}</small>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {message.metadata.title && <h3>{message.metadata.title}</h3>}
                  {message.content && <p className="assistant-answer">{message.content}{message.state === "streaming" && <span className="overview-chat-cursor" aria-hidden="true" />}</p>}
                  {message.state === "error" && <p className="assistant-error-line"><CircleAlert size={14} /> {message.error}</p>}
                  {(message.metadata.backgroundRun?.status === "queued" || message.metadata.backgroundRun?.status === "running") && (
                    <div className="assistant-msg-actions"><button type="button" className="assistant-link" onClick={() => void cancelInvestigation(message.metadata.backgroundRun!.id)}>Cancel investigation</button></div>
                  )}
                  {settled && (
                    <>
                      {message.metadata.sourceLabels?.length ? (
                        <div className="assistant-sources"><span>Sources</span>{message.metadata.sourceLabels.map((label) => <em key={label}>{label}</em>)}</div>
                      ) : null}
                      {(message.metadata.limitations?.filter(Boolean).length || message.metadata.suggestedAction) ? (
                        <ul className="assistant-notes">
                          {message.metadata.limitations?.filter(Boolean).map((item) => <li key={item}><strong>Limit</strong> {item}</li>)}
                          {message.metadata.suggestedAction && <li><strong>Next step</strong> {message.metadata.suggestedAction}</li>}
                        </ul>
                      ) : null}
                      {message.metadata.proposal && <ActionProposalCard proposal={message.metadata.proposal} canReview={canReviewProposals} onOpenCase={onOpenCase} onReviewed={(proposal) => {
                        setMessages((current) => current.map((item) => item.metadata.proposal?.id === proposal.id ? { ...item, metadata: { ...item.metadata, proposal } } : item));
                        if (proposal.status === "approved") onActionApplied?.();
                        if (activeConversationId) void loadConversation(activeConversationId).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Conversation refresh failed."));
                      }} />}
                      <div className="assistant-msg-actions">
                        {message.metadata.action && <button type="button" className="assistant-action" onClick={() => message.metadata.action?.caseId ? onOpenCase(message.metadata.action.caseId) : message.metadata.action?.filter ? onFilterCases(message.metadata.action.filter) : onViewCases()}>{message.metadata.action.label} <ArrowRight size={14} /></button>}
                        <button type="button" className="assistant-link" onClick={() => void copyAnswer(message)}><Copy size={13} /> {copiedId === message.id ? "Copied" : "Copy"}</button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <form className="assistant-composer" onSubmit={submit}>
          <input ref={fileRef} className="sr-only" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={selectAttachment} tabIndex={-1} aria-label="Choose a text attachment" />
          <label className="sr-only" htmlFor="overview-assistant-question">
            Ask about the current portfolio
          </label>
          {attachment && (
            <div className="assistant-attachment">
              <FileText size={14} /> <span>{attachment.name}</span>
              <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachment(null)} disabled={busy}><X size={13} /></button>
            </div>
          )}
          <textarea
            id="overview-assistant-question"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={keyDown}
            maxLength={300}
            rows={1}
            placeholder="Ask about this portfolio…"
            disabled={busy || loadingHistory}
          />
          <div className="assistant-composer-bar">
            <div className="assistant-tools">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || loadingHistory} aria-label="Attach a TXT or CSV file" title="Attach a TXT or CSV file up to 64 KB">
                <Paperclip size={16} />
              </button>
              <button type="button" onClick={startVoiceInput} aria-label={listening ? "Stop voice input" : "Use voice input"} title={listening ? "Stop voice input" : "Voice input"} aria-pressed={listening} disabled={busy || loadingHistory}>
                <Mic size={16} />
              </button>
              {mode === "live" && <button type="button" className="with-label" onClick={() => void startBackgroundInvestigation()} disabled={busy || loadingHistory || !question.trim() || Boolean(attachment)} title="Investigate in the background and return to this conversation later">
                <Search size={15} /> Investigate
              </button>}
            </div>
            <div className="assistant-send-wrap">
              {question.length >= 240 && <span className="assistant-count">{question.length}/300</span>}
              <button
                className="assistant-send"
                type="submit"
                aria-label="Ask question"
                disabled={busy || loadingHistory || (!question.trim() && !attachment)}
              >
                {busy ? <LoaderCircle size={17} className="overview-assistant-spinner" /> : <ArrowUp size={17} />}
              </button>
            </div>
          </div>
        </form>
        {error && <p className="overview-assistant-error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}

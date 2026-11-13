import React, { useCallback, useEffect, useState } from "react";
import type { ContextDebugOverview, ContextDebugRun } from "../../shared/contextDebug";

const field = "w-full rounded border border-white/15 bg-transparent p-2 text-xs no-drag";
const button = "rounded border border-white/15 px-2 py-1.5 text-xs disabled:opacity-40 no-drag";
const stringify = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const terms = (value: unknown): string[] | undefined => Array.isArray(value)
  ? value.filter((term): term is string => typeof term === "string") : undefined;

function Value({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return <div><p className="font-medium mb-1">{label}</p><pre className="whitespace-pre-wrap break-words rounded bg-black/15 p-2 text-[11px] max-h-44 overflow-auto select-text">{stringify(value)}</pre></div>;
}

function RunDetails({ run, image }: { run: ContextDebugRun; image?: string }) {
  const native = run.events.find(event => event.stage === "native-context")?.data;
  const ax = native?.accessibility as Record<string, unknown> | undefined;
  const ocr = native?.ocr as Record<string, unknown> | undefined;
  const chosen = ocr ?? ax;
  const selected = terms(chosen?.selectedTerms);
  const accepted = run.events.filter(event => event.stage === "context-acceptance").at(-1)?.data;
  const stopped = run.events.find(event => event.stage === "speech-stopped")?.data;
  const correction = run.events.filter(event => event.stage === "correction").at(-1)?.data;
  const dictionary = terms(correction?.dictionary);
  const used = dictionary ? new Set(dictionary.map(term => term.toLocaleLowerCase())) : undefined;
  const tags = chosen?.appleTags as { text: string; tag: string; selected: boolean }[] | undefined;
  const frame = native?.windowFrame as number[] | undefined;
  const crop = native?.cropInWindowPoints as number[] | undefined;
  const units = native?.coordinateNote ? "image pixels" : "points";
  return <div className="space-y-3">
    <Value label="App and source" value={native ? { app: native.app, source: native.source } : "Waiting for capture details. A timeout or protected field can have no details."} />
    <Value label="Replay scope" value={native?.coordinateNote} />
    <Value label="Context handoff" value={{
      accessibilityCharacters: typeof ax?.text === "string" ? ax.text.length : null,
      ocrCharacters: typeof ocr?.text === "string" ? ocr.text.length : null,
      extractedTerms: selected?.length ?? null,
      acceptedBySession: accepted?.accepted ?? null,
      acceptedTerms: terms(accepted?.terms) ?? null,
      termsAtSpeechStop: terms(stopped?.termsReady) ?? null,
      finalDictionaryCount: dictionary?.length ?? null,
      extractedTermsAbsentFromFinalDictionary: selected && used ? selected.filter(term => !used.has(term.toLocaleLowerCase())) : null,
    }} />
    {frame?.length === 4 && crop?.length === 4 && <div>
      <p className="mb-1">Blue area: the crop inside the window</p>
      <svg role="img" aria-label="OCR crop within the active window" viewBox={`0 0 ${frame[2]} ${frame[3]}`} className="w-full max-h-32">
        <rect width={frame[2]} height={frame[3]} fill="currentColor" opacity="0.12" />
        <rect x={crop[0]} y={crop[1]} width={crop[2]} height={crop[3]} fill="#38bdf8" opacity="0.6" />
      </svg>
      <p className="mt-1 text-muted-foreground">{Math.round(crop[2])} × {Math.round(crop[3])} {units} · {String(native?.pixels)} pixels</p>
    </div>}
    {image ? <img src={image} alt="The exact crop sent to local OCR" className="w-full rounded border border-white/15" /> : <p className="text-muted-foreground">No image saved. Accessibility reads text without taking a screenshot.</p>}
    <Value label="Accessibility text" value={ax?.text} />
    <Value label="OCR text" value={ocr?.text} />
    <Value label="OCR lines, confidence and bounds" value={ocr?.ocrLines} />
    {tags && <details><summary className="cursor-pointer">Apple tags: accepted and rejected words</summary>
      <table className="w-full mt-2 text-left text-[11px]"><thead><tr><th>Text</th><th>Tag</th><th>Selected</th></tr></thead><tbody>
        {tags.map((tag, index) => <tr key={index} className="border-t border-white/10"><td className="py-1 break-all">{tag.text}</td><td>{tag.tag}</td><td>{tag.selected ? "Yes" : "No"}</td></tr>)}
      </tbody></table>
    </details>}
    <Value label="Identifier rule matches" value={chosen?.identifierRuleMatches} />
    <Value label="Selected screen terms" value={chosen?.selectedTerms} />
    {run.events.filter(event => event.stage === "decode-request").map((event, i) => <Value key={`request${i}`} label={`Model input ${i + 1}`} value={event.data} />)}
    {run.events.filter(event => event.stage === "correction").map((event, i) => <div key={`result${i}`} className="space-y-2">
      <Value label={`Raw speech result ${i + 1}`} value={event.data.raw} />
      <Value label="After local correction" value={event.data.corrected} />
      <details><summary className="cursor-pointer">Show correction decisions</summary><Value label="Matches and rejected spans" value={event.data.trace} /><Value label="Dictionary used" value={event.data.dictionary} /></details>
    </div>)}
    <Value label="Final text sent toward insertion" value={run.events.find(event => event.stage === "renderer-final")?.data.text} />
    <p className="text-muted-foreground">Audio clips saved: {run.audio.length}. Open the set folder to play the WAV files.</p>
    <details><summary className="cursor-pointer">All stages and timings</summary><Value label="Milliseconds from recording start" value={run.events.map(({ atMs, stage, data }) => ({ atMs, stage, ...(stage === "native-context" ? {} : { data }) }))} /></details>
  </div>;
}

export default function ContextDebugPanel() {
  const [overview, setOverview] = useState<ContextDebugOverview>();
  const [setId, setSetId] = useState<string>();
  const [runId, setRunId] = useState("");
  const [detail, setDetail] = useState<{ run: ContextDebugRun; image?: string }>();
  const [label, setLabel] = useState("Names across apps");
  const [audio, setAudio] = useState(false);
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const api = window.contextDebug;
  const refresh = useCallback(async () => {
    const next = await api?.overview(setId);
    if (next) setOverview(next);
  }, [api, setId]);
  useEffect(() => {
    let live = true;
    const update = async () => { try { const next = await api?.overview(setId); if (live && next) setOverview(next); } catch { if (live) setMessage("Could not read debug sets."); } };
    void update();
    const timer = overview?.recording ? setInterval(() => void update(), 2000) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [api, setId, overview?.recording]);
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    if (runId && overview?.setId) void api?.read(overview.setId, runId).then(value => {
      if (!live) return;
      setDetail(value); setExpected(value.run.expected); setNotes(value.run.notes);
    }).catch(() => { if (live) setMessage("Could not open this run."); });
    return () => { live = false; };
  }, [api, runId, overview?.setId]);
  if (!api) return null;
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Debug action failed."); }
    finally { setBusy(false); }
  };
  return <div className="p-3 space-y-3 text-xs text-foreground/80 no-drag">
    <p>Save test runs on this Mac. Each run can include screen text, the OCR crop, detected terms, and speech results. Nothing is uploaded.</p>
    {overview?.recording ? <div className="flex items-center justify-between gap-2">
      <strong role="status">● Saving debug runs</strong>
      <button className={button} disabled={busy} onClick={() => void action(async () => { setOverview(await api.stop()); })}>Stop saving</button>
    </div> : <>
      <input className={field} aria-label="Test set name" value={label} onChange={event => setLabel(event.target.value)} maxLength={120} />
      <label className="flex gap-2 items-center"><input type="checkbox" checked={audio} onChange={event => setAudio(event.target.checked)} />Include audio for speech decoder comparisons</label>
      <button className={button} disabled={busy} onClick={() => void action(async () => { const next = await api.start(label, audio); setSetId(next.setId ?? undefined); setOverview(next); setRunId(""); })}>Start test set</button>
    </>}
    <p className="text-muted-foreground">Start a set, switch to your test app, then dictate normally. Saving stops after 50 runs or when Spoke quits. Finish a dictation before starting another set.</p>
    {overview?.error && <p role="status">{overview.error}</p>}
    {!!overview?.sets.length && <>
      <select className={field} aria-label="Saved test set" value={overview.setId ?? ""} onChange={event => { setSetId(event.target.value); setRunId(""); }}>
        {overview.sets.map(set => <option key={set.id} value={set.id}>{set.label} · {set.id.slice(0, 10)}</option>)}
      </select>
      <div className="flex gap-2">
        <button className={button} disabled={busy} onClick={() => void action(async () => { await api.openFolder(overview.setId ?? undefined); })}>Open set folder</button>
        <button className={button} disabled={busy} onClick={() => void action(refresh)}>Refresh runs</button>
      </div>
      <select className={field} aria-label="Debug run" value={runId} onChange={event => setRunId(event.target.value)}>
        <option value="">Choose a run ({overview.runs.length})</option>
        {overview.runs.map((run, i) => <option key={run.id} value={run.id}>#{overview.runs.length - i} · {new Date(run.createdAt).toLocaleTimeString()} · {run.expected || run.stages.at(-1)}</option>)}
      </select>
    </>}
    {detail && overview?.setId && <>
      <label className="block">Expected text<textarea className={`${field} mt-1`} value={expected} onChange={event => setExpected(event.target.value)} maxLength={4000} rows={2} /></label>
      <label className="block">Notes<textarea className={`${field} mt-1`} value={notes} onChange={event => setNotes(event.target.value)} maxLength={4000} rows={2} /></label>
      <div className="flex gap-2">
        <button className={button} disabled={busy} onClick={() => void action(async () => { await api.annotate(overview.setId as string, runId, expected, notes); await refresh(); setMessage("Expected text and notes saved."); })}>Save labels</button>
        <button className={button} disabled={busy} onClick={() => void action(async () => { await api.remove(overview.setId as string, runId); setRunId(""); await refresh(); })}>Delete this run</button>
        <button className={button} disabled={busy} onClick={() => void action(async () => { setDetail(await api.read(overview.setId as string, runId)); })}>Refresh details</button>
      </div>
      <RunDetails {...detail} />
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}

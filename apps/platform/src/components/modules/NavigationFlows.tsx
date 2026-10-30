"use client";

import { useState } from "react";

const PAGE_PATH: Record<string, string> = {
  Home: "/",
  Aesthetic: "/aesthetic",
  "Family medicine": "/family-medicine",
  Doctors: "/doctors",
  Contact: "/contact",
  Diabetes: "/diabetes",
  Thyroid: "/thyroid",
  Articles: "/articles",
  "Heart screening": "/heart-screening",
  Consultations: "/consultations",
  Team: "/team",
};

const BAR = ["#136c72", "#2f8f96", "#7ec9cd", "#c5e4e6"];
const ORDINALS = ["1st page", "2nd page", "3rd page", "4th page"];
const COL = 228;
const BAR_W = 36;
const TOP = 36;
const PLOT = 248;
const NODE_GAP = 8;
const MAX_NODES = 4;

type Flow = { name: string; current: number };
type Node = { page: string; count: number; y: number; h: number; pct: number; more: boolean };
type Band = { step: number; from: string; to: string; count: number; x1: number; y1: number; h1: number; x2: number; y2: number; h2: number };

function pageLabel(step: string) {
  return PAGE_PATH[step] ?? (step.startsWith("/") ? step : step);
}

function shares(counts: number[]) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((count) => (count / total) * 100);
  const rounded = raw.map((value) => Math.floor(value));
  let drift = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let step = 0; drift > 0 && step < order.length; step += 1) {
    rounded[order[step]!.index] = (rounded[order[step]!.index] ?? 0) + 1;
    drift -= 1;
  }
  return rounded;
}

function collapse(entries: Array<{ page: string; count: number }>) {
  const sorted = [...entries].sort((a, b) => b.count - a.count || a.page.localeCompare(b.page));
  if (sorted.length <= MAX_NODES) return sorted.map((entry) => ({ ...entry, more: false }));
  const kept = sorted.slice(0, MAX_NODES - 1).map((entry) => ({ ...entry, more: false }));
  const rest = sorted.slice(MAX_NODES - 1);
  kept.push({ page: `${rest.length} more pages`, count: rest.reduce((sum, entry) => sum + entry.count, 0), more: true });
  return kept;
}

function place(entries: Array<{ page: string; count: number; more: boolean }>): Node[] {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const percents = shares(entries.map((entry) => entry.count));
  const gaps = NODE_GAP * Math.max(entries.length - 1, 0);
  let heights = entries.map((entry) => Math.max(40, (entry.count / total) * (PLOT - gaps)));
  const used = heights.reduce((sum, height) => sum + height, 0);
  if (used + gaps > PLOT) heights = heights.map((height) => (height * (PLOT - gaps)) / used);
  let y = 0;
  return entries.map((entry, index) => {
    const h = heights[index] ?? 0;
    const node = { page: entry.page, count: entry.count, y, h, pct: percents[index] ?? 0, more: entry.more };
    y += h + NODE_GAP;
    return node;
  });
}

function bandPath(band: Band) {
  const { x1, y1, h1, x2, y2, h2 } = band;
  const mid = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2} L ${x2} ${y2 + h2} C ${x2 - mid} ${y2 + h2}, ${x1 + mid} ${y1 + h1}, ${x1} ${y1 + h1} Z`;
}

function build(flows: Flow[]) {
  const paths = flows.flatMap((flow) => {
    const steps = flow.name.split("→").map((step) => pageLabel(step.trim())).filter(Boolean).slice(0, 4);
    return flow.current > 0 && steps.length ? [{ steps, count: flow.current }] : [];
  });
  const depth = Math.min(4, paths.reduce((max, path) => Math.max(max, path.steps.length), 0));
  const grouped = Array.from({ length: depth }, () => new Map<string, number>());
  const linkCounts = new Map<string, number>();
  for (const path of paths) {
    path.steps.forEach((page, step) => {
      grouped[step]!.set(page, (grouped[step]!.get(page) ?? 0) + path.count);
      const next = path.steps[step + 1];
      if (next) {
        const key = `${step}|${page}|${next}`;
        linkCounts.set(key, (linkCounts.get(key) ?? 0) + path.count);
      }
    });
  }
  const columns = grouped.map((pages) => place(collapse([...pages].map(([page, count]) => ({ page, count })))));
  const visible = columns.map((nodes) => new Set(nodes.filter((node) => !node.more).map((node) => node.page)));
  const mergedLinks = new Map<string, number>();
  for (const [key, count] of linkCounts) {
    const [stepText, from, to] = key.split("|");
    if (!from || !to) continue;
    const step = Number(stepText);
    const source = visible[step]?.has(from) ? from : columns[step]?.find((node) => node.more)?.page;
    const target = visible[step + 1]?.has(to) ? to : columns[step + 1]?.find((node) => node.more)?.page;
    if (!source || !target) continue;
    const merged = `${step}|${source}|${target}`;
    mergedLinks.set(merged, (mergedLinks.get(merged) ?? 0) + count);
  }
  const bands: Band[] = [];
  for (let step = 0; step < columns.length - 1; step += 1) {
    const sources = columns[step] ?? [];
    const targets = columns[step + 1] ?? [];
    const sourceOffset = new Map<string, number>();
    const targetOffset = new Map<string, number>();
    const pairs = [...mergedLinks]
      .flatMap(([key, count]) => {
        const [stepText, from, to] = key.split("|");
        return Number(stepText) === step && from && to ? [{ from, to, count }] : [];
      })
      .sort((a, b) => (targets.findIndex((node) => node.page === a.to) - targets.findIndex((node) => node.page === b.to)) || a.from.localeCompare(b.from));
    for (const pair of pairs) {
      const source = sources.find((node) => node.page === pair.from);
      const target = targets.find((node) => node.page === pair.to);
      if (!source || !target || source.count <= 0 || target.count <= 0) continue;
      const h1 = source.h * (pair.count / source.count);
      const h2 = target.h * (pair.count / target.count);
      const y1 = TOP + source.y + (sourceOffset.get(source.page) ?? 0);
      const y2 = TOP + target.y + (targetOffset.get(target.page) ?? 0);
      sourceOffset.set(source.page, (sourceOffset.get(source.page) ?? 0) + h1);
      targetOffset.set(target.page, (targetOffset.get(target.page) ?? 0) + h2);
      bands.push({ step, from: pair.from, to: pair.to, count: pair.count, x1: step * COL + BAR_W, y1, h1, x2: (step + 1) * COL, y2, h2 });
    }
  }
  const dropped = columns.map((nodes, step) => {
    const next = columns[step + 1];
    if (!next) return null;
    const reached = nodes.reduce((sum, node) => sum + node.count, 0);
    const continued = next.reduce((sum, node) => sum + node.count, 0);
    const left = reached - continued;
    if (reached <= 0 || left <= 0) return null;
    return { pct: Math.round((left / reached) * 100), count: left };
  });
  return { columns, bands, dropped, width: Math.max(columns.length, 1) * COL };
}

function countLabel(value: number) {
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(value);
}

function nodeKey(step: number, page: string) {
  return `${step}|${page}`;
}

export function NavigationFlows({ flows }: { flows: Flow[] }) {
  const chart = build(flows);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  if (chart.columns.length === 0) return null;
  const active = hover ?? pinned;
  const outgoing = active ? chart.bands.filter((band) => nodeKey(band.step, band.from) === active) : [];
  const lit = new Set<string>();
  if (active) {
    lit.add(active);
    for (const band of outgoing) lit.add(nodeKey(band.step + 1, band.to));
  }
  const activeNode = active
    ? chart.columns.flatMap((nodes, step) => nodes.map((node) => ({ ...node, step }))).find((node) => nodeKey(node.step, node.page) === active)
    : null;
  const continued = outgoing.reduce((sum, band) => sum + band.count, 0);
  const stopped = activeNode ? Math.max(0, activeNode.count - continued) : 0;
  const height = TOP + PLOT + 28;
  const choose = (key: string) => setPinned((current) => (current === key ? null : key));
  return (
    <div className="px-5 pt-1 pb-4">
      <svg viewBox={`0 0 ${chart.width} ${height}`} preserveAspectRatio="xMinYMin meet" className="block h-72 w-full" role="group" aria-label="Navigation flow. Choose a page to see where visitors go next." onPointerLeave={() => setHover(null)}>
        {chart.columns.slice(0, -1).map((_, step) => (
          <text key={step} x={(step + 1) * COL - 18} y="16" textAnchor="middle" fill="#9aafb2" fontSize="14">›</text>
        ))}
        {chart.columns.map((_, step) => (
          <text key={ORDINALS[step]} x={step * COL} y="16" fill="#5b7479" fontSize="12" fontWeight="600">{ORDINALS[step]}</text>
        ))}
        {chart.bands.map((band) => {
          const hot = !active || nodeKey(band.step, band.from) === active;
          return <path key={`${band.step}|${band.from}|${band.to}`} d={bandPath(band)} fill={hot ? "#7ec9cd" : "#e7f4f5"} opacity={hot ? 1 : 0.35} />;
        })}
        {chart.columns.map((nodes, step) => nodes.map((node, index) => {
          const key = nodeKey(step, node.page);
          const on = !active || lit.has(key);
          const fill = node.more ? "#e7eef0" : BAR[Math.min(index, BAR.length - 1)]!;
          const ink = !node.more && index < 2 ? "#ffffff" : "#173c40";
          const labelX = step * COL + BAR_W + 10;
          const labelY = TOP + node.y + 14;
          const next = chart.bands.filter((band) => nodeKey(band.step, band.from) === key).map((band) => band.to).join(", ");
          return (
            <g key={key} opacity={on ? 1 : 0.3} className="cursor-pointer" role="button" tabIndex={0} aria-pressed={pinned === key} aria-label={next ? `${node.page}, ${countLabel(node.count)} sessions, continues to ${next}` : `${node.page}, ${countLabel(node.count)} sessions, last recorded step`} onPointerEnter={() => setHover(key)} onFocus={() => setHover(key)} onBlur={() => setHover((current) => (current === key ? null : current))} onClick={() => choose(key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(key); } }}>
              <rect x={step * COL} y={TOP + node.y} width={BAR_W} height={node.h} rx="4" fill={fill} stroke={active === key ? "#173c40" : "none"} strokeWidth="2" />
              {node.h >= 32 && (
                <text x={step * COL + BAR_W / 2} y={TOP + node.y + node.h - 8} textAnchor="middle" fill={ink} fontSize="11" fontWeight="600" pointerEvents="none">{node.pct}%</text>
              )}
              <text x={labelX} y={labelY} fill="#173c40" fontSize="13" fontWeight="600" pointerEvents="none">{node.page}</text>
              <text x={labelX} y={labelY + 16} fill="#5b7479" fontSize="12" pointerEvents="none">{countLabel(node.count)}</text>
              <rect x={step * COL} y={TOP + node.y} width={COL - 16} height={Math.max(node.h, 36)} fill="transparent" />
            </g>
          );
        }))}
        {chart.dropped.map((drop, step) => drop && (
          <text key={ORDINALS[step]} x={step * COL} y={height - 6} fill="#5b7479" fontSize="12">
            <tspan fontWeight="600" fill="#173c40">{drop.pct}%</tspan>
            <tspan> {countLabel(drop.count)} dropped off</tspan>
          </text>
        ))}
      </svg>
      <p role="status" className="mt-2 min-h-5 text-sm text-ink-soft">
        {activeNode && outgoing.length > 0 && `${activeNode.page} continues to ${outgoing.map((band) => `${band.to} (${countLabel(band.count)})`).join(", ")}.`}
        {activeNode && outgoing.length === 0 && `${activeNode.page} is the last recorded step.`}
        {activeNode && stopped > 0 && ` ${countLabel(stopped)} stopped here.`}
        {!activeNode && "Choose a page to see where visitors go next."}
      </p>
      <ol className="sr-only">
        {flows.filter((flow) => flow.current > 0).map((flow) => (
          <li key={flow.name}>{flow.name}, {countLabel(flow.current)} sessions</li>
        ))}
      </ol>
    </div>
  );
}

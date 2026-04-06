#!/usr/bin/env node

/**
 * Claude Code Chat History Reviewer
 *
 * Scans local Claude Code conversation history, detects corrections and
 * feedback patterns, and generates a lessons-learned report.
 *
 * Usage:
 *   node scripts/review-history.mjs                  # Full interactive report
 *   node scripts/review-history.mjs --lessons        # Generate LESSONS.md
 *   node scripts/review-history.mjs --json           # Output raw JSON
 *   node scripts/review-history.mjs --project <path> # Filter by project path
 *   node scripts/review-history.mjs --since 7d       # Only last 7 days
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";

// ── Config ──────────────────────────────────────────────────────────────────

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");

// Patterns that indicate the user is correcting Claude
const CORRECTION_PATTERNS = [
  { pattern: /\bno[,.]?\s+(that'?s?\s+)?(not|wrong|incorrect)/i, label: "Direct correction" },
  { pattern: /\bactually[,\s]/i, label: "Correction with 'actually'" },
  { pattern: /\binstead[,\s]/i, label: "Redirect with 'instead'" },
  { pattern: /\bthat'?s?\s+(not\s+)?(what\s+I\s+(meant|wanted|asked))/i, label: "Misunderstanding correction" },
  { pattern: /\bdon'?t\s+(do|add|change|remove|delete|modify|create|use|include)/i, label: "Negative instruction" },
  { pattern: /\bstop\s+(doing|adding|changing)/i, label: "Stop instruction" },
  { pattern: /\bplease\s+(revert|undo|rollback|go\s+back)/i, label: "Revert request" },
  { pattern: /\brevert\s+(that|this|the\s+change)/i, label: "Revert request" },
  { pattern: /\bwrong\s+(file|approach|direction|way)/i, label: "Wrong approach" },
  { pattern: /\btoo\s+(complex|complicated|much|many|verbose|long)/i, label: "Complexity complaint" },
  { pattern: /\bover[- ]?engineer/i, label: "Over-engineering complaint" },
  { pattern: /\bsimpl(er|ify|istic)/i, label: "Simplification request" },
  { pattern: /\byou\s+(missed|forgot|overlooked|skipped|ignored)/i, label: "Missed requirement" },
  { pattern: /\bthat\s+(broke|breaks|broken)/i, label: "Breakage report" },
  { pattern: /\bnot\s+working/i, label: "Not working report" },
  { pattern: /\bdoesn'?t\s+(work|compile|build|run|pass)/i, label: "Failure report" },
  { pattern: /\bI\s+(said|told\s+you|already\s+said|mentioned)/i, label: "Repeated instruction" },
  { pattern: /\bwhy\s+(did|are)\s+you/i, label: "Questioning Claude's action" },
  { pattern: /\bI\s+didn'?t\s+ask\s+(for|you\s+to)/i, label: "Unsolicited change" },
  { pattern: /\bremove\s+(that|this|the|those|all\s+the)/i, label: "Removal request" },
];

// Patterns that indicate positive feedback
const POSITIVE_PATTERNS = [
  { pattern: /\b(perfect|excellent|great\s+job|nicely?\s+done|well\s+done|awesome|fantastic)/i, label: "Praise" },
  { pattern: /\bthat'?s?\s+(exactly|perfect|great|what\s+I\s+wanted)/i, label: "Confirmation" },
  { pattern: /\bthank(s|\s+you)/i, label: "Thanks" },
  { pattern: /\blooks?\s+good/i, label: "Approval" },
  { pattern: /\byes[,!.\s]?\s*(that'?s?\s*)?(it|right|correct|good)/i, label: "Affirmation" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    lessons: args.includes("--lessons"),
    json: args.includes("--json"),
    verbose: args.includes("--verbose") || args.includes("-v"),
    project: null,
    since: null,
    help: args.includes("--help") || args.includes("-h"),
  };

  const projIdx = args.indexOf("--project");
  if (projIdx !== -1 && args[projIdx + 1]) {
    opts.project = args[projIdx + 1];
  }

  const sinceIdx = args.indexOf("--since");
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    opts.since = parseDuration(args[sinceIdx + 1]);
  }

  return opts;
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(d|h|w|m)$/);
  if (!match) return null;
  const [, num, unit] = match;
  const ms = {
    h: 3600000,
    d: 86400000,
    w: 604800000,
    m: 2592000000,
  };
  return Date.now() - parseInt(num) * ms[unit];
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c.type === "tool_use").map((c) => c.name);
}

function truncate(str, len = 200) {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Core parsing ────────────────────────────────────────────────────────────

function loadSessions() {
  const sessions = {};
  if (!existsSync(SESSIONS_DIR)) return sessions;

  for (const file of readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), "utf-8"));
      sessions[data.sessionId] = data;
    } catch {}
  }
  return sessions;
}

function discoverConversationFiles(projectFilter) {
  const files = [];
  if (!existsSync(PROJECTS_DIR)) return files;

  for (const projectDir of readdirSync(PROJECTS_DIR)) {
    const projectPath = join(PROJECTS_DIR, projectDir);
    if (!statSync(projectPath).isDirectory()) continue;

    if (projectFilter) {
      const decoded = projectDir.replace(/-/g, "/");
      if (!decoded.includes(projectFilter)) continue;
    }

    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith(".jsonl")) continue;
      files.push({
        path: join(projectPath, file),
        projectDir,
        sessionId: basename(file, ".jsonl"),
      });
    }
  }

  return files;
}

function parseConversation(filePath, sinceTimestamp) {
  const lines = readFileSync(filePath, "utf-8").trim().split("\n");
  const messages = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "user" && obj.type !== "assistant") continue;
      if (sinceTimestamp && obj.timestamp) {
        const ts = new Date(obj.timestamp).getTime();
        if (ts < sinceTimestamp) continue;
      }
      messages.push({
        role: obj.type,
        content: obj.message?.content ?? "",
        text: extractTextContent(obj.message?.content ?? ""),
        tools: obj.type === "assistant" ? extractToolUses(obj.message?.content ?? "") : [],
        timestamp: obj.timestamp,
        sessionId: obj.sessionId,
        gitBranch: obj.gitBranch,
        cwd: obj.cwd,
      });
    } catch {}
  }

  return messages;
}

// ── Analysis ────────────────────────────────────────────────────────────────

function analyzeConversation(messages) {
  const corrections = [];
  const positives = [];
  const exchanges = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const text = msg.text;
    if (!text) continue;

    // Find preceding assistant message for context
    let prevAssistant = null;
    for (let j = i - 1; j >= 0; j--) {
      if (messages[j].role === "assistant" && messages[j].text) {
        prevAssistant = messages[j];
        break;
      }
    }

    // Find following assistant response
    let nextAssistant = null;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === "assistant" && messages[j].text) {
        nextAssistant = messages[j];
        break;
      }
    }

    // Check for correction patterns
    for (const { pattern, label } of CORRECTION_PATTERNS) {
      if (pattern.test(text)) {
        corrections.push({
          label,
          userMessage: text,
          assistantBefore: prevAssistant?.text ?? null,
          assistantAfter: nextAssistant?.text ?? null,
          toolsBefore: prevAssistant?.tools ?? [],
          timestamp: msg.timestamp,
          sessionId: msg.sessionId,
          gitBranch: msg.gitBranch,
        });
        break; // Only count the first matching pattern per message
      }
    }

    // Check for positive patterns
    for (const { pattern, label } of POSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        positives.push({
          label,
          userMessage: text,
          timestamp: msg.timestamp,
        });
        break;
      }
    }

    // Record exchange
    exchanges.push({
      user: text,
      assistantBefore: prevAssistant?.text ?? null,
      timestamp: msg.timestamp,
      sessionId: msg.sessionId,
    });
  }

  return { corrections, positives, exchanges };
}

function categorizeCorrections(corrections) {
  const categories = {};
  for (const c of corrections) {
    const cat = c.label;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(c);
  }
  return categories;
}

function extractLessons(categorized) {
  const lessons = [];

  for (const [category, items] of Object.entries(categorized)) {
    if (items.length < 1) continue;

    const examples = items.slice(0, 3).map((item) => ({
      userSaid: truncate(item.userMessage, 300),
      context: item.assistantBefore ? truncate(item.assistantBefore, 200) : null,
      when: item.timestamp ? formatDate(item.timestamp) : "unknown",
      branch: item.gitBranch ?? "unknown",
    }));

    lessons.push({
      category,
      occurrences: items.length,
      examples,
    });
  }

  // Sort by frequency
  lessons.sort((a, b) => b.occurrences - a.occurrences);
  return lessons;
}

// ── Output formatters ───────────────────────────────────────────────────────

function printReport(allResults, opts) {
  const totalExchanges = allResults.reduce((s, r) => s + r.analysis.exchanges.length, 0);
  const totalCorrections = allResults.reduce((s, r) => s + r.analysis.corrections.length, 0);
  const totalPositives = allResults.reduce((s, r) => s + r.analysis.positives.length, 0);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║           Claude Code Chat History Review                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`  Sessions analyzed:  ${allResults.length}`);
  console.log(`  Total exchanges:    ${totalExchanges}`);
  console.log(`  Corrections found:  ${totalCorrections}`);
  console.log(`  Positive feedback:  ${totalPositives}`);
  if (totalExchanges > 0) {
    const ratio = ((totalCorrections / totalExchanges) * 100).toFixed(1);
    console.log(`  Correction ratio:   ${ratio}%`);
  }
  console.log("");

  // Aggregate corrections across all sessions
  const allCorrections = allResults.flatMap((r) => r.analysis.corrections);
  const categorized = categorizeCorrections(allCorrections);
  const lessons = extractLessons(categorized);

  if (lessons.length === 0) {
    console.log("  No correction patterns detected. Either everything went smoothly");
    console.log("  or more history is needed for analysis.\n");
    return { lessons, totalCorrections, totalExchanges, totalPositives };
  }

  console.log("─── Correction Patterns (by frequency) ────────────────────────\n");

  for (const lesson of lessons) {
    const bar = "█".repeat(Math.min(lesson.occurrences, 30));
    console.log(`  ${lesson.category} (${lesson.occurrences}x)`);
    console.log(`  ${bar}\n`);

    if (opts.verbose) {
      for (const ex of lesson.examples) {
        console.log(`    When: ${ex.when} | Branch: ${ex.branch}`);
        console.log(`    User: "${ex.userSaid}"`);
        if (ex.context) {
          console.log(`    Claude was: "${ex.context}"`);
        }
        console.log("");
      }
    } else {
      // Show first example briefly
      const ex = lesson.examples[0];
      console.log(`    e.g. "${truncate(ex.userSaid, 120)}"`);
      console.log("");
    }
  }

  // Timeline view
  const timelineEntries = allCorrections
    .filter((c) => c.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (timelineEntries.length > 0) {
    console.log("─── Correction Timeline ───────────────────────────────────────\n");
    for (const entry of timelineEntries.slice(-20)) {
      const date = formatDate(entry.timestamp);
      console.log(`  [${date}] ${entry.label}`);
      console.log(`    "${truncate(entry.userMessage, 100)}"\n`);
    }
  }

  return { lessons, totalCorrections, totalExchanges, totalPositives };
}

function generateLessonsMarkdown(lessons, stats) {
  const lines = [
    "# Lessons Learned from Chat History",
    "",
    `> Auto-generated on ${new Date().toISOString().split("T")[0]} by \`scripts/review-history.mjs\``,
    `> Based on ${stats.totalExchanges} exchanges across ${stats.sessionCount} sessions`,
    "",
    "## Summary",
    "",
    `- **Corrections detected:** ${stats.totalCorrections}`,
    `- **Positive feedback:** ${stats.totalPositives}`,
    `- **Correction ratio:** ${stats.totalExchanges > 0 ? ((stats.totalCorrections / stats.totalExchanges) * 100).toFixed(1) : 0}%`,
    "",
    "## Patterns to Avoid",
    "",
  ];

  for (const lesson of lessons) {
    lines.push(`### ${lesson.category} (${lesson.occurrences}x)`);
    lines.push("");

    for (const ex of lesson.examples) {
      lines.push(`- **User said:** "${ex.userSaid}"`);
      if (ex.context) {
        lines.push(`  - **Claude was doing:** "${ex.context}"`);
      }
      lines.push(`  - *${ex.when}* on branch \`${ex.branch}\``);
    }
    lines.push("");
  }

  lines.push("## Guidelines for Future Sessions");
  lines.push("");

  // Generate actionable guidelines from patterns
  const guidelineMap = {
    "Direct correction": "Double-check assumptions before acting. Ask clarifying questions when requirements are ambiguous.",
    "Correction with 'actually'": "Pay close attention to the exact wording of requests. Don't assume intent.",
    "Redirect with 'instead'": "Present the simplest approach first. When multiple paths exist, ask which one the user prefers.",
    "Misunderstanding correction": "Restate understanding of the task before starting implementation.",
    "Negative instruction": "Stick strictly to what was asked. Don't add unrequested features or changes.",
    "Stop instruction": "Check scope before making changes. Only modify what was explicitly requested.",
    "Revert request": "Make small, incremental changes that are easy to review and revert.",
    "Wrong approach": "Consider the broader context before choosing an implementation strategy.",
    "Complexity complaint": "Start with the simplest possible solution. Only add complexity when justified.",
    "Over-engineering complaint": "Avoid premature abstractions. Write concrete code for concrete problems.",
    "Simplification request": "Prefer straightforward code over clever solutions. Readability > brevity.",
    "Missed requirement": "Review all requirements before starting. Check back against the original request when done.",
    "Breakage report": "Test changes before presenting them. Consider side effects on existing functionality.",
    "Not working report": "Verify that generated code compiles and runs before presenting it.",
    "Failure report": "Run tests after making changes. Don't assume code works without verification.",
    "Repeated instruction": "Track all instructions given in a conversation. Don't lose context from earlier messages.",
    "Questioning Claude's action": "Explain reasoning before taking action, especially for non-obvious decisions.",
    "Unsolicited change": "Only make changes that were explicitly requested. Ask before adding extras.",
    "Removal request": "Don't add extra code, comments, or features unless asked for them.",
  };

  for (const lesson of lessons) {
    const guideline = guidelineMap[lesson.category];
    if (guideline) {
      lines.push(`- **${lesson.category}:** ${guideline}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
Claude Code Chat History Reviewer

Usage:
  node scripts/review-history.mjs [options]

Options:
  --lessons         Generate LESSONS.md file with actionable guidelines
  --json            Output analysis as JSON
  --verbose, -v     Show detailed examples for each pattern
  --project <path>  Filter to conversations from a specific project path
  --since <dur>     Only analyze recent history (e.g., 7d, 2w, 1m)
  --help, -h        Show this help

Examples:
  node scripts/review-history.mjs --verbose
  node scripts/review-history.mjs --lessons --since 2w
  node scripts/review-history.mjs --project factory --json
`);
    process.exit(0);
  }

  if (!existsSync(PROJECTS_DIR)) {
    console.error("No Claude Code history found at", PROJECTS_DIR);
    console.error("Make sure you have used Claude Code locally first.");
    process.exit(1);
  }

  const conversationFiles = discoverConversationFiles(opts.project);

  if (conversationFiles.length === 0) {
    console.error("No conversation files found.");
    process.exit(1);
  }

  const sessionMeta = loadSessions();
  const allResults = [];

  for (const file of conversationFiles) {
    const messages = parseConversation(file.path, opts.since);
    if (messages.length === 0) continue;

    const analysis = analyzeConversation(messages);
    const meta = sessionMeta[file.sessionId] ?? {};

    allResults.push({
      sessionId: file.sessionId,
      projectDir: file.projectDir,
      messageCount: messages.length,
      startedAt: meta.startedAt ? formatDate(meta.startedAt) : messages[0]?.timestamp ?? "unknown",
      cwd: meta.cwd ?? messages[0]?.cwd ?? "unknown",
      analysis,
    });
  }

  if (allResults.length === 0) {
    console.log("No conversations found matching your filters.");
    process.exit(0);
  }

  if (opts.json) {
    const allCorrections = allResults.flatMap((r) => r.analysis.corrections);
    const categorized = categorizeCorrections(allCorrections);
    const lessons = extractLessons(categorized);
    console.log(
      JSON.stringify(
        {
          sessions: allResults.map((r) => ({
            sessionId: r.sessionId,
            project: r.projectDir,
            messages: r.messageCount,
            corrections: r.analysis.corrections.length,
            positives: r.analysis.positives.length,
          })),
          lessons,
          totalExchanges: allResults.reduce((s, r) => s + r.analysis.exchanges.length, 0),
          totalCorrections: allResults.reduce((s, r) => s + r.analysis.corrections.length, 0),
          totalPositives: allResults.reduce((s, r) => s + r.analysis.positives.length, 0),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { lessons, totalCorrections, totalExchanges, totalPositives } = printReport(allResults, opts);

  if (opts.lessons) {
    const md = generateLessonsMarkdown(lessons, {
      totalCorrections,
      totalExchanges,
      totalPositives,
      sessionCount: allResults.length,
    });

    const outPath = resolve("LESSONS.md");
    writeFileSync(outPath, md, "utf-8");
    console.log(`\n✓ Wrote ${outPath}`);
    console.log("  Add this to your CLAUDE.md or project instructions to close the feedback loop.\n");
  }
}

main();

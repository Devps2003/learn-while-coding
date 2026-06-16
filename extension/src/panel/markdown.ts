function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escCode(s: string): string {
  return escHtml(s).replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let out = escHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  return out;
}

function renderListBlock(lines: string[]): string {
  const items = lines
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .map((line) => `<li>${inlineFormat(line)}</li>`)
    .join("");
  return `<ul class="rich-list">${items}</ul>`;
}

export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }

  const blocks: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        `<pre class="code-block"${lang ? ` data-lang="${escHtml(lang)}"` : ""}><code>${escCode(codeLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const listLines: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        listLines.push(lines[i].trim());
        i++;
      }
      blocks.push(renderListBlock(listLines));
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^[-*]\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(`<p class="rich-p">${inlineFormat(paraLines.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, index, options, env, self);
};

export function renderMarkdown(source) {
  return markdown.render(String(source ?? ""));
}

/**
 * 提取 Markdown 渲染后真正可见的文字，排除标题、列表、强调、链接等语法标记。
 * 链接只保留标签，代码块保留代码内容，图片保留替代文字。
 *
 * @param {unknown} source
 */
export function extractMarkdownText(source) {
  const tokens = markdown.parse(String(source ?? ""), {});
  const parts = [];

  const appendInlineText = (inlineTokens) => {
    for (const token of inlineTokens ?? []) {
      if (token.type === "text" || token.type === "code_inline") {
        parts.push(token.content);
      } else if (token.type === "image") {
        appendInlineText(token.children);
      }
    }
  };

  for (const token of tokens) {
    if (token.type === "inline") {
      appendInlineText(token.children);
    } else if (token.type === "fence" || token.type === "code_block") {
      parts.push(token.content);
    }
  }

  return parts.join("\n");
}

/** 统计 Markdown 可见文字的 Unicode code points，忽略空白。 */
export function countMarkdownCharacters(source) {
  return Array.from(extractMarkdownText(source).replace(/\s/gu, "")).length;
}

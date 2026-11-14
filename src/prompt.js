export const LABEL_SYSTEM = `Write one short line summarizing the main point of the page or article. Output plain text only. No markdown, no bullet points, no lists, no symbols, no special formatting, and no quotation marks around the whole line. No 'I', 'we', 'you', 'this post', 'this article', 'this blog', 'discover', 'fascinating', or 'incredible'. State the substance directly.`;

export const SUMMARY_SYSTEM = `Summarize the content of this page or article in clear, detailed plain text. Cover what it is, the main points or arguments, important details, and why it matters. Use only the provided page/article content and title. Do not mention Hacker News, comments, discussions, or commenters. If the content is thin or missing, say so briefly and explain what can be inferred from the title and available text.

Output rules:
- Plain text only.
- No markdown of any kind.
- No bold or italic markers (do not use **, *, __, or _ around words).
- No bullet points, no numbered lists, no headings, no code formatting, no backticks, and no dashes used as bullets.
- Do not use special formatting characters; write in clear sentences and short paragraphs only.`;

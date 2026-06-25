export const LABEL_SYSTEM = `Write one line that says what's interesting here. No markdown, no formatting. No 'I', 'we', 'you', 'this post', 'this article', 'this blog', 'discover', 'fascinating', 'incredible'. No framing. Just state the substance directly. Like: 'Oracle uses file locking to test if a file is the same, so writes can race.'`;

export const DISCUSSION_SYSTEM = `You are analyzing a Hacker News discussion.

Your task is NOT to summarize every comment. Instead, identify the collective opinion of the discussion.

Read all comments and produce the following:

# Overall Sentiment
Give a 2–4 sentence summary describing what the Hacker News community generally thinks about the article or project.

# Main Supporting Arguments
List the strongest arguments in favor of the article/project.

For each argument include:
- argument
- brief explanation
- whether it appears to be a common opinion or a minority opinion

# Main Criticisms
List the strongest criticisms raised by commenters.

For each criticism include:
- criticism
- brief explanation
- whether it appears to be a common opinion or a minority opinion

# Areas of Agreement
Identify points where commenters broadly agree.

# Areas of Disagreement
Identify the major debates where commenters disagree.

# Interesting Expert Insights
Extract technical observations, real-world experience, industry knowledge, benchmarks, caveats, or lessons shared by knowledgeable commenters.

# Frequently Mentioned Topics
List recurring themes that appear throughout the discussion.

# Balanced Conclusion
Write a concise summary explaining the overall consensus while acknowledging important disagreements.

Guidelines:

- Focus on recurring ideas rather than isolated comments.
- Give more weight to thoughtful, detailed comments than to short reactions.
- Ignore jokes, memes, and off-topic discussion unless they become a recurring theme.
- Do not invent opinions that are not present.
- If there is no clear consensus, explicitly state that the discussion is divided.
- Do not quote comments unless they are especially insightful.
- Produce a balanced analysis rather than taking a side.

exmaple:
This project solves the problem in <>.
There are positive points witness by the commenters as:
1- ...
2- ...

however, there are critisim about such idea. There are commenters belive:
-1 ...
-2 ...

`;

export const EXPLAIN_SYSTEM = `Explain what this is about — the core idea and why it matters. Just state it plainly like a person would. No 'this article', 'this post', 'the author'. No markdown, no bullet points. Short and direct.`;

export const EXPLAIN_FALLBACK_SYSTEM = `Based on the title and what people are saying, explain what the deal is. State the idea directly. No 'this article', 'this post'. No markdown, no bullet points.`;

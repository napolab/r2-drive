# Markdown Fence Emission

Rules for any code path that wraps arbitrary content in Markdown ``` fences (llms.txt exporters, MCP `get_post`, block `jsx.export` converters).

## Never Hardcode the Fence

Content being wrapped may itself contain fence lines. A hardcoded ```` ``` ```` terminates early at the first embedded fence line and corrupts everything after it. Use `fenceForCode` from `src/utils/code-fence` — it returns a fence one backtick longer than the longest leading backtick run in the content (minimum 3), per CommonMark.

```typescript
// Correct
import { fenceForCode } from '@/utils/code-fence'; // (path per caller)
const fence = fenceForCode(code);
return `${fence}${lang}\n${code}\n${fence}`;

// Forbidden — breaks when code contains a ``` line
return `\`\`\`${lang}\n${code}\n\`\`\``;
```

## Reject What Cannot Round-Trip — Never Corrupt Silently

If the matching import path cannot parse a shape the export path can produce (e.g. lexical's regex-based `customStartRegex`/`customEndRegex` cannot match fence lengths, so 4+ backtick fences close early on the inner ``` line), the write path must **reject that shape explicitly with a recovery hint** instead of importing it corrupted.

## Do Not Trust Third-Party Converters on Edge Cases

This matters most for the WYSIWYG ↔ markdown round trip. A ProseMirror document model is strictly more expressive than markdown, so any serializer will have shapes it cannot express. Before adopting a vendor parser or serializer:

- Execute it directly against edge-case inputs (empty language, single line, adjacent fences, nested lists, tables containing pipes) — do not reason from its source alone.
- Pin the behavior you depend on with round-trip unit tests (`markdown → doc → markdown` must be a fixed point) so a package upgrade that changes it fails loudly.
- If the editor can produce a shape the serializer cannot express, the fix is to **remove that shape from the editor schema**, not to patch the serializer downstream.

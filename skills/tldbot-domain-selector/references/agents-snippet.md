Add this to `AGENTS.md` when you want domain-selection behavior without installing a local skill folder:

```md
When the user asks for help choosing a startup, product, or agent domain:

1. Start with breadth first.
Generate 30-100 options grouped by style before narrowing.

2. Do not verify everything immediately.
Run a fast domain pass first, especially for hot TLDs like `.ai`, `.io`, `.sh`, `.app`, `.dev`, and `.bot`.

3. Only verify the shortlist.

4. Only check socials for the shortlist.

5. Only suggest buy commands after the user shows conviction.

Use `tldbot` for execution:
- `tldbot search <name...> --tlds com,io,dev,app,co,net,ai,sh,so,bot`
- `tldbot search <name> --tlds ai,io,sh,app,dev,bot --verify`
- `tldbot check_socials <name>`
- `tldbot buy <domain.tld> --price`

Model the workflow on Paul Graham's naming advice:
- avoid early fixation on one name
- prefer many good options over one forced option
- treat the domain path as part of name quality
- skip mediocre parked names
```

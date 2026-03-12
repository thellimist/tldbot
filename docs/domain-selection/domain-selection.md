---
summary: Guide to choosing a startup or AI-agent domain, based on Paul Graham essays and public comments, then adapted into a practical tldbot workflow.
read_when:
  - You are helping someone choose a product, startup, or agent domain.
  - You need a naming workflow that balances breadth, speed, and verification.
  - You want a concise synthesis of Paul Graham's naming advice and how it applies to domain search.
---

# Domain Selection

## Why This Guide Exists

Most founders narrow too early.
They start with one favorite name, then try to force domain availability around it.

That is backwards.

The better process is:
1. generate many credible options
2. screen them quickly
3. only deepen verification on the shortlist
4. buy when conviction is high

That matches both Paul Graham's naming advice and the practical constraints of domain search.

## Paul Graham's Core Ideas

### 1. A good name matters, but perfection is not the first job

In Paul Graham's essay about naming startups, the recurring point is that founders should avoid obviously bad names, but they should not freeze themselves chasing a mythical perfect one.

The practical takeaway:
- avoid names that are confusing, hard to spell, or feel generic
- prefer names that are easy to say and easy to remember
- move quickly once a name is clearly workable

Source:
- Paul Graham, "How to Name a Startup": https://paulgraham.com/name.html

### 2. Cheap, decent names still exist if you search broadly

Paul Graham has also said publicly that it is still possible to find strong `.com` names, including short ones, if you are willing to generate options instead of obsessing over one exact word.

The practical takeaway:
- do not start from one rigid exact-match target
- start from a large set of options and look for survivors
- breadth beats fixation

Sources:
- HN discussion quoting Paul Graham on finding available five-letter `.com` names: https://news.ycombinator.com/item?id=31133434
- Secondary archive of his X post on finding a five-letter `.com`: https://twstalker.com/paulg/status/1516856119740141575

### 3. Great names can be worth money, but "make offer" domains are usually a bad starting point

Paul Graham has also argued that a real company can justify paying meaningful money for a truly strong name, but he separately warned that founders should usually skip names already sitting behind "make offer" pages.

Those are not contradictory.

The practical takeaway:
- if the name is merely decent, keep moving
- if the name is genuinely strong and central to the company, paying real money can be rational
- do not waste early cycles negotiating every parked name you encounter

Sources:
- Secondary write-up quoting Paul Graham on domain prices and "skip the ones that say make offer": https://domainnamewire.com/2024/04/16/paul-graham-says-to-pass-on-domains-that-say-make-offer/
- Domains article covering the same public comments: https://domaininvesting.com/paul-graham-domain-name-comments/

### 4. The name is not the company, but it changes how easily the company spreads

Paul Graham's broader naming advice is consistent on this point:
- the name does not create product quality
- the name does affect recall, introductions, word of mouth, and trust

So the right standard is not "perfect".
It is "strong enough that it helps rather than hurts."

## A Practical Naming Standard

Use these filters:

### Keep

- easy to pronounce
- easy to spell after hearing once
- short enough to say naturally
- distinctive enough to search
- broad enough to grow with the product

### Reject

- awkward spelling tricks
- names that require explanation
- names that collide with many existing brands
- names that feel locked to one feature or one temporary trend
- names where the best available domain is only a weak compromise

## The tldbot Workflow

This is the workflow the product should encourage.

### Step 1. Start with breadth, not selection

Generate a lot of candidates first.

Good first pass:
- 30 to 100 names
- grouped by style

Useful buckets:
- literal
- compound
- coined
- tool-like
- operator-like
- infrastructure-like
- brandable/abstract

The goal is not to pick.
The goal is to create optionality.

### Step 2. Fast-screen domains before emotional commitment

Run a wide first pass with `tldbot` before debating subtle branding questions.

Example:

```bash
tldbot search_domain domagent domainmcp searchmcp tldagent dnsagent --tlds com,io,dev,app,co,net,ai,sh,so,bot
```

Interpret the first pass like this:
- low-pressure TLDs can usually be trusted quickly
- hot/rate-limited TLDs should be treated as provisional until a shortlist exists

### Step 3. Shortlist only the survivors

Keep names that satisfy both:
- strong enough brand signal
- acceptable domain path

A name with no good domain path is usually not a real option.

### Step 4. Verify only the names you actually like

This is where rate-limit strategy matters.

For hot TLDs such as `.ai`, `.io`, `.sh`, `.app`, `.dev`, and sometimes `.bot`:
- use fast mode first
- verify only the shortlist

Example:

```bash
tldbot search_domain tldbot tldagent domainmcp --tlds ai,io,sh,app,dev --verify
```

That mirrors the right product behavior:
- broad search first
- expensive certainty second

### Step 5. Check socials only after the shortlist exists

Do not social-check 50 names.
Social-check 3 to 10 names.

Example:

```bash
tldbot check_socials tldbot
```

### Step 6. Only inspect price and buy path after conviction

If the name is available:

```bash
tldbot --buy tldbot.com --price
```

If the name is for sale:
- inspect the marketplace result
- decide whether it is worth the ask
- otherwise move on

This is where Paul Graham's advice matters most:
- do not negotiate every parked name
- pay up only when the name is actually strong enough to deserve it

## Recommended Interaction Pattern

For an agent or assistant, the best flow is:

1. offer lots of options first
2. ask which naming direction feels right
3. search broadly in fast mode
4. shortlist
5. verify the shortlist
6. social-check the shortlist
7. inspect price and buy path

That ordering preserves optionality and avoids wasting rate-limited checks on names the user will discard anyway.

## Output Formats That Work Well

### Round 1: options only

Return:
- 20 to 50 names
- grouped by style
- no deep verification yet

### Round 2: shortlist with domain state

Return:
- shortlist names
- best domain state per candidate
- note which results are still provisional

### Round 3: execution

Return:
- verified domains
- social status for finalists
- buy commands for finalists

## Bottom Line

Paul Graham's advice points toward one clear operating rule:

Do not fall in love with one name too early.

Generate many good options.
Let domain reality eliminate weak ones quickly.
Only spend verification, pricing, and negotiation effort on the shortlist.

That is the right naming process for humans, and it is also the right workflow for `tldbot`.

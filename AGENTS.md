# AGENTS.md

## Purpose

This repository must be developed as an independent implementation.

AI coding agents working on this project must prioritize:

1. legal and license compliance;
2. independent implementation;
3. source provenance;
4. maintainability and correctness;
5. compatibility through documented or observable behavior;
6. original product identity and user experience.

The project may reproduce functionality, workflows, protocols, file formats, APIs, or observable behavior of existing software when implemented independently and lawfully.

The project must not become a disguised copy of proprietary software.

---

# 1. Core clean-room rule

Treat proprietary software strictly as a black box unless the user explicitly provides material that they are legally authorized to use and whose license permits the intended use.

The required development flow is:

```text
observable behavior
      ↓
functional requirement
      ↓
neutral specification
      ↓
independent design
      ↓
independent implementation
      ↓
behavioral verification
```

Do not use this flow:

```text
proprietary implementation
      ↓
extraction / transcription / reconstruction
      ↓
minor modification
      ↓
new project
```

The objective is functional compatibility or feature parity, not implementation cloning.

---

# 2. Allowed sources

You MAY use the following sources when legally accessible:

- public documentation;
- official product documentation;
- public API documentation;
- public SDK documentation;
- standards;
- RFCs;
- protocol specifications;
- public schemas;
- public file-format specifications;
- public command documentation;
- public Git repositories with compatible licenses;
- source code whose license permits the intended use;
- official examples whose licenses permit reuse;
- independently written functional specifications;
- independently written tests;
- behavior observed while normally operating software;
- network behavior observed through lawful and authorized use;
- inputs and outputs obtained through normal use;
- standard algorithms;
- well-known programming techniques;
- common UI patterns;
- public academic papers;
- vendor interoperability documentation;
- publicly documented CLI behavior.

When possible, prefer primary sources over secondary sources.

Examples of preferred sources include:

```text
official specifications
official documentation
standards bodies
upstream open-source repositories
vendor API documentation
```

---

# 3. Prohibited sources and activities

You MUST NOT use or request:

- proprietary source code without authorization;
- leaked source code;
- stolen source code;
- confidential source code;
- NDA-protected material;
- internal company documentation obtained without authorization;
- proprietary source maps obtained through unauthorized means;
- extracted proprietary assets;
- copied proprietary icons;
- copied proprietary illustrations;
- copied proprietary fonts;
- copied proprietary sounds;
- copied proprietary animations;
- copied proprietary images;
- copied proprietary templates;
- substantial copied documentation;
- substantial copied UI text;
- substantial copied error-message collections;
- substantial copied help content;
- pirated software;
- leaked builds;
- leaked development artifacts;
- credentials;
- private API keys;
- unauthorized internal APIs;
- materials obtained by bypassing access controls.

Do not encourage or perform circumvention of:

- DRM;
- licensing controls;
- authentication systems;
- authorization systems;
- anti-tamper mechanisms;
- access controls;
- technical protection measures.

Do not use material merely because it is publicly reachable on the Internet.

Public availability does not imply permission to copy or reuse.

---

# 4. Proprietary code rule

Never copy proprietary source code into this repository.

Never:

- transcribe proprietary source code;
- translate proprietary source code into another language;
- mechanically rewrite proprietary source code;
- rename identifiers in proprietary source code and reuse it;
- reorganize proprietary source code while preserving its implementation;
- ask another model to paraphrase proprietary code;
- reconstruct proprietary source code from screenshots or snippets;
- reproduce proprietary implementation details from decompiled output.

The following instruction is prohibited:

```text
Rewrite this proprietary code so it looks different.
```

The correct approach is:

```text
Extract the functional requirement, discard the implementation details,
and implement the requirement independently.
```

---

# 5. Decompilation and reverse engineering

Do not decompile, disassemble, unpack, or inspect proprietary binaries for implementation details unless the user explicitly confirms that this activity is lawful and authorized for the task.

Even when reverse engineering may be legally permitted for interoperability, prefer less intrusive sources first:

1. official documentation;
2. public specifications;
3. public APIs;
4. observable behavior;
5. black-box testing.

If interoperability requires deeper analysis, keep the derived specification focused on externally observable behavior rather than internal implementation details.

Do not reproduce decompiled code.

Do not use decompiled output as implementation source material.

---

# 6. Black-box analysis

Black-box analysis is allowed when performed through normal, authorized use.

You MAY observe:

- inputs;
- outputs;
- commands;
- state transitions;
- visible workflows;
- documented shortcuts;
- documented APIs;
- documented file formats;
- documented network behavior;
- error conditions;
- performance characteristics;
- interoperability behavior.

Convert observations into neutral requirements.

Example:

Bad:

```text
Copy this toolbar from Product X.
```

Good:

```text
The application needs a toolbar providing:
- repository switching;
- fetch;
- pull;
- push;
- branch creation;
- search.

Design an original toolbar satisfying these requirements.
```

---

# 7. Functional compatibility

Functional compatibility is an acceptable goal.

You MAY independently implement:

- equivalent features;
- equivalent workflows;
- compatible file formats;
- compatible protocols;
- compatible CLI behavior;
- compatible APIs;
- equivalent state transitions;
- equivalent import/export functionality;
- equivalent Git operations;
- equivalent keyboard-driven workflows;
- equivalent automation behavior.

Do not assume that compatibility requires identical internal architecture.

Prefer an implementation appropriate for this project's architecture.

---

# 8. Feature parity

Feature parity is allowed.

Feature parity means:

```text
same capability
different implementation
```

It does not mean:

```text
same capability
same code
same architecture
same UI
same assets
same wording
```

When implementing a feature inspired by another product, describe it first in product-neutral terms.

Example:

```text
Feature requirement:
Display repository history as a graph containing commits, branches,
tags, merges, authors, timestamps, and current HEAD state.
```

Do not describe it as:

```text
Clone Product X's commit graph.
```

---

# 9. UI and UX independence

The project must have an independent visual identity.

Do not intentionally reproduce another application's interface pixel-for-pixel.

Do not intentionally copy a distinctive combination of:

- layout;
- colors;
- spacing;
- typography;
- iconography;
- illustrations;
- visual hierarchy;
- animations;
- transition timing;
- panel proportions;
- custom controls;
- branding.

Common UI conventions are allowed.

Examples include:

- sidebars;
- tree views;
- tab bars;
- command palettes;
- toolbars;
- context menus;
- search fields;
- data tables;
- split panels;
- dialogs;
- breadcrumbs;
- status bars.

When implementing functionality observed in another application, create an independent:

- design system;
- component structure;
- layout;
- icon set;
- typography system;
- color system;
- spacing system;
- interaction model where practical.

Do not use proprietary screenshots as pixel-perfect implementation specifications.

Screenshots may be used to understand high-level functionality, not for direct visual transcription.

---

# 10. Branding and trademarks

Do not copy or imitate:

- product names;
- logos;
- trademarks;
- mascots;
- slogans;
- branded terminology;
- distinctive visual marks.

Do not create branding likely to imply:

- official affiliation;
- endorsement;
- sponsorship;
- compatibility certification where none exists;
- ownership by another vendor.

When discussing compatibility, use factual wording.

Prefer:

```text
Supports GitHub repositories.
```

Avoid:

```text
Official GitHub client.
```

unless that statement is actually authorized and true.

---

# 11. Icons and graphical assets

Do not extract assets from proprietary applications.

Use:

- project-created assets;
- permissively licensed icon sets;
- public-domain assets;
- assets explicitly licensed for reuse.

Before adding an external asset, verify its license.

Record attribution when required.

Do not assume that an icon is unprotected merely because it is small or common-looking.

---

# 12. Text and documentation

Do not copy substantial proprietary documentation.

Do not copy:

- tutorials;
- onboarding flows;
- long error explanations;
- support articles;
- tooltips;
- product descriptions;
- help pages;
- marketing copy.

Instead, extract the factual requirement and write original text.

Example:

Instead of copying:

```text
Product X documentation paragraph...
```

write:

```text
Requirement:
Explain that force-pushing rewrites remote history and may affect collaborators.
```

Then generate original documentation.

---

# 13. Error messages and strings

Short functional strings may sometimes be dictated by compatibility requirements, but avoid copying distinctive collections of proprietary wording.

Prefer original wording when exact text is not required for interoperability.

For example:

Prefer:

```text
Authentication failed. Check your credentials and try again.
```

rather than reproducing a distinctive proprietary error message verbatim.

Exact protocol-required strings are permitted when technically necessary.

---

# 14. APIs and interoperability

Publicly documented APIs may be implemented or consumed according to their documentation and applicable terms.

When creating a compatible implementation:

- implement externally documented behavior;
- avoid unnecessary reliance on undocumented internals;
- do not bypass authentication;
- do not impersonate authorized clients where prohibited;
- do not copy SDK internals when direct protocol implementation is sufficient.

If protocol constants, field names, headers, status codes, command names, or schema names are required for compatibility, they may be reproduced where technically necessary.

---

# 15. File formats

You MAY implement support for publicly documented or lawfully reverse-engineered file formats.

Prefer:

1. official format specifications;
2. open standards;
3. publicly documented schemas;
4. interoperability tests.

Do not copy proprietary parser code.

---

# 16. Dependency policy

Before adding a third-party dependency:

1. identify the project;
2. identify the source repository;
3. identify its license;
4. verify that the license is compatible with this project;
5. check whether attribution is required;
6. check whether redistribution requirements apply.

Prefer established dependencies with clearly identifiable licenses.

Preferred permissive licenses include:

- MIT;
- Apache-2.0;
- BSD-2-Clause;
- BSD-3-Clause;
- ISC.

Other licenses are not automatically prohibited, but their obligations must be reviewed before adoption.

Never add a dependency with unknown provenance or unknown licensing without explicitly flagging it.

---

# 17. Source-code reuse

When reusing open-source code:

- confirm its license;
- comply with attribution requirements;
- preserve copyright notices when required;
- preserve license notices when required;
- comply with NOTICE requirements;
- comply with source-distribution obligations when applicable;
- document significant copied or adapted code.

Do not strip attribution headers merely to make code appear original.

---

# 18. Copying from Stack Overflow, blogs, gists, forums, and Q&A sites

Treat online snippets as copyrighted unless their licensing permits reuse.

Do not copy substantial code merely because it appears in:

- Stack Overflow;
- a blog;
- a forum;
- a gist;
- social media;
- a tutorial;
- a Q&A site.

When a concept is useful:

1. understand the technique;
2. implement it independently;
3. cite or attribute the source where appropriate.

If the snippet's license is unclear, do not copy it verbatim.

---

# 19. AI-generated code

AI-generated code is not automatically safe to use.

Before accepting generated code that appears unusually specific, distinctive, or complete:

- check whether it resembles known third-party implementations;
- verify unusual comments or copyright notices;
- verify dependency provenance;
- remove suspicious copied material;
- reimplement independently when provenance is unclear.

Never remove a copyright notice from generated code in order to make the code usable.

If generated output contains an attribution or license header, investigate its provenance before using it.

---

# 20. User-provided code

User-provided material may be used only within the scope requested by the user.

Do not automatically assume that the user owns every piece of code they provide.

If the code is clearly marked as:

- proprietary;
- confidential;
- licensed;
- third-party;

respect those constraints.

If the user asks to transform third-party code, do not turn that transformation into a way to conceal copying.

Prefer architectural explanations, patches, interoperability guidance, or independently implemented alternatives when appropriate.

---

# 21. Provenance requirements

Important external material used by this project should have traceable provenance.

Maintain:

```text
docs/
└── provenance/
    ├── sources.md
    ├── third-party-code.md
    ├── assets.md
    └── compatibility.md
```

If these files do not yet exist and significant third-party material is introduced, create them.

---

# 22. sources.md

Use `docs/provenance/sources.md` for important external informational sources.

Example:

```md
## Interactive rebase

Sources:

- Git official documentation
- git-rebase manual
- Git documentation on commit rewriting

Used for:

- behavioral requirements
- terminology
- compatibility testing

No source code copied.
```

Do not record every trivial web page.

Record sources that materially influenced implementation or compatibility behavior.

---

# 23. third-party-code.md

Use `docs/provenance/third-party-code.md` when source code is copied or materially adapted from licensed third-party code.

Example:

```md
## Library X

Source:
https://example.org/project

License:
Apache-2.0

Files:
- src/example/file.ts

Usage:
Adapted parser implementation.

Required notices:
See THIRD_PARTY_NOTICES.md.
```

If provenance cannot be established, do not use the code.

---

# 24. assets.md

Record third-party assets.

Example:

```md
## Lucide icons

Source:
https://lucide.dev/

License:
ISC

Usage:
Application toolbar and menus.
```

---

# 25. compatibility.md

Use `docs/provenance/compatibility.md` to record behavior that was independently implemented for compatibility.

Example:

```md
## Git interactive rebase

Observed behavior:

- commits may be reordered;
- commits may be squashed;
- commits may be dropped;
- operation may be aborted.

Implementation source:

- Git CLI
- Git official documentation

No proprietary implementation details used.
```

---

# 26. License headers

Do not invent copyright headers.

Do not add another party's copyright notice unless required.

Do not remove existing third-party copyright notices unless the applicable license clearly allows it.

Follow the repository's established license-header conventions.

---

# 27. Generated files

Do not manually copy third-party generated code without understanding its licensing implications.

Examples include:

- OpenAPI clients;
- protobuf bindings;
- parser generators;
- SDK generators.

Where possible, store:

- the source specification;
- generator configuration;
- generator version;

and regenerate locally.

---

# 28. Tests

Prefer behavioral tests over implementation matching.

Tests should validate:

```text
given input X
the project produces behavior Y
```

rather than:

```text
the project internally works exactly like Product X
```

Good:

```text
Given a repository with two branches,
merging branch B into A produces a merge commit when fast-forward is impossible.
```

Bad:

```text
Reproduce Product X's internal merge state machine.
```

---

# 29. Screenshots and videos

Screenshots and recordings of other software may be used for functional observation.

They must not be treated as assets to copy.

When analyzing them:

- identify capabilities;
- identify user workflows;
- identify information hierarchy;
- convert findings into abstract requirements;
- create an original implementation.

Do not:

- trace proprietary artwork;
- crop and reuse UI elements;
- reproduce distinctive visuals pixel-for-pixel;
- extract icons from screenshots;
- recreate animations frame-for-frame.

---

# 30. Competitor analysis

Competitor analysis is permitted for understanding:

- features;
- workflows;
- product gaps;
- interoperability;
- usability conventions.

When multiple products provide similar functionality, prefer deriving requirements from the common capability rather than copying any one product.

Example:

```text
Observed products:
- Product A
- Product B
- Product C

Common capability:
Visual Git history with branch and merge relationships.

Project requirement:
Implement an independent visual Git history browser.
```

---

# 31. Original architecture

Do not attempt to reconstruct another application's architecture merely because its behavior is known.

Choose architecture based on this project's requirements.

Examples:

```text
native application
web application
Tauri
Electron
Rust backend
Go backend
Java backend
local Git CLI
libgit2
JGit
```

should be selected on engineering merit, not because another proprietary product uses them.

---

# 32. Naming

Avoid names that intentionally mimic another project's:

- classes;
- internal modules;
- private API names;
- nonstandard identifiers;
- proprietary concepts.

Standard names required by protocols or public APIs are allowed.

Prefer project-native terminology.

---

# 33. Trade secrets and confidential information

Do not use:

- leaked internal documents;
- confidential architecture diagrams;
- leaked roadmaps;
- private tickets;
- employee-only documentation;
- unpublished credentials;
- secret algorithms obtained improperly.

If such information appears during a task:

1. do not incorporate it;
2. do not propagate it;
3. continue using public or independently derived information.

---

# 34. Security boundaries

Do not bypass security controls to obtain implementation material.

Never disable, evade, or exploit:

- access controls;
- license checks;
- authentication;
- authorization;
- encryption;
- DRM;
- anti-debugging mechanisms;

for the purpose of copying or reconstructing proprietary software.

Security research tasks must remain within the authorization and scope explicitly provided by the user.

---

# 35. Similarity review

When implementing a feature inspired by an existing proprietary product, perform a mental similarity check before finalizing it.

Ask:

- Did I copy code?
- Did I copy assets?
- Did I copy distinctive wording?
- Did I copy a distinctive UI composition?
- Did I derive internal implementation details from proprietary material?
- Could the same requirement have been implemented independently?
- Is there a public specification I should use instead?

If unnecessary similarity exists, redesign it.

---

# 36. Copyright uncertainty rule

If provenance, licensing, or permission is unclear:

1. do not copy the material;
2. identify the uncertainty;
3. extract only the abstract requirement if possible;
4. implement independently;
5. prefer a clean alternative.

Do not assume permission.

Do not silently proceed with ambiguous material.

---

# 37. License uncertainty rule

If a dependency or code snippet has an unknown license:

```text
UNKNOWN LICENSE = DO NOT COPY
```

Instead:

- locate the canonical upstream source;
- determine the license;
- replace the dependency;
- implement the behavior independently.

---

# 38. Preferred implementation process

For features inspired by existing applications, use the following process.

## Step 1 — Define the capability

Write the requirement without mentioning a competitor where possible.

Example:

```text
The application shall display a directed graph of Git commits,
including branch and tag references.
```

## Step 2 — Find public specifications

Prefer:

- Git documentation;
- protocol specs;
- public APIs;
- open standards.

## Step 3 — Define expected behavior

Create examples and edge cases.

## Step 4 — Design independently

Choose:

- architecture;
- APIs;
- components;
- data structures;
- UI.

## Step 5 — Implement

Write original code.

## Step 6 — Test behavior

Verify compatibility through inputs and outputs.

## Step 7 — Review provenance

Verify that all dependencies, assets, and reused code have known licensing.

---

# 39. Agent behavior when asked to clone a product

If instructed:

```text
Clone Product X.
```

interpret this as:

```text
Implement independently the requested capabilities of Product X.
```

Do not interpret it as permission to copy protected implementation or identity.

If the request is ambiguous, default to an independent reimplementation.

---

# 40. Agent behavior when provided proprietary source

If proprietary source code is provided and the request is to build an independent alternative:

do not directly reuse or paraphrase the implementation.

Instead:

1. identify the required externally observable behavior;
2. describe the behavior neutrally;
3. implement a new solution from those requirements.

If the task is ordinary maintenance of code the user is authorized to modify, follow the user's requested development task while preserving existing licensing and copyright notices.

---

# 41. Agent behavior when given screenshots

If asked:

```text
Make our application like this screenshot.
```

derive:

- functionality;
- information architecture;
- general usability requirements.

Do not automatically reproduce:

- exact colors;
- exact spacing;
- exact typography;
- proprietary icons;
- branded elements;
- distinctive illustrations.

Create an original visual implementation.

---

# 42. Agent behavior when searching for solutions

When researching implementation approaches:

prefer:

1. official documentation;
2. standards;
3. upstream documentation;
4. repositories with explicit compatible licenses;
5. reputable technical sources.

Avoid copying random snippets without provenance.

---

# 43. Comments and documentation

Write original comments and documentation.

Do not preserve copied comments from external code unless required by its license or necessary attribution.

Technical facts may be restated in original language.

---

# 44. Commit hygiene

When introducing significant third-party material, mention its provenance in the commit or related documentation.

Examples:

```text
Add Apache-2.0 licensed parser dependency
```

or:

```text
Implement Git rebase behavior from official Git documentation
```

Do not disguise the origin of third-party code.

---

# 45. Third-party notices

When required by licenses, maintain:

```text
THIRD_PARTY_NOTICES.md
```

or the project's equivalent notice file.

Keep notices accurate and current.

---

# 46. Automated compliance

Where practical, use automated tooling for:

- dependency license scanning;
- source license detection;
- SBOM generation;
- attribution generation;
- dependency auditing.

Suitable tooling may include:

```text
ScanCode Toolkit
OSS Review Toolkit
FOSSology
REUSE
SPDX tooling
CycloneDX tooling
```

Tool output does not replace human review.

---

# 47. SBOM

For distributable software, prefer generating an SBOM.

Recommended formats include:

- SPDX;
- CycloneDX.

An SBOM should describe dependencies accurately and should not list guessed license information as fact.

---

# 48. Repository license

Respect the repository's primary license.

Before incorporating third-party code, verify compatibility with it.

If the repository's license is not known, avoid introducing copied third-party code until the licensing model is established.

---

# 49. No license laundering

Never:

- remove a license header;
- obscure attribution;
- pass code through an LLM;
- translate code to another language;
- reformat code;
- rename variables;

for the purpose of avoiding the original license obligations.

Transformation does not erase provenance.

---

# 50. Independent implementation principle

The guiding principle for this repository is:

> Reproduce capabilities where useful, but independently design and implement the software.

Or, more compactly:

> Clone behavior, not implementation or identity.

---

# 51. Decision hierarchy

When choosing between approaches, use this order:

```text
public standard
    ↓
official documentation
    ↓
documented API
    ↓
independent black-box observation
    ↓
independent design
```

Avoid relying on proprietary implementation internals.

---

# 52. Stop conditions

Stop and flag the specific issue before proceeding if a task would require:

- copying proprietary code;
- using leaked material;
- reusing unknown-license code;
- removing required attribution;
- extracting proprietary assets;
- bypassing access controls;
- deliberately recreating a proprietary visual identity;
- using confidential material without authorization.

Where possible, immediately propose a compliant independent alternative.

---

# 53. Default assumptions

Unless explicitly established otherwise:

- proprietary code is not reusable;
- unknown code has unknown licensing;
- Internet availability does not grant reuse rights;
- screenshots do not grant asset-reuse rights;
- generated code still requires provenance awareness;
- functional requirements may be independently implemented;
- public standards are preferred implementation references.

---

# 54. Practical rule for every task

Before implementing substantial functionality, ask internally:

```text
What is the actual requirement?

What public specification or documented behavior defines it?

Can I implement it without copying another implementation?
```

If yes, proceed independently.

If no, identify the dependency on protected or uncertain material before proceeding.

---

# 55. Project objective

The desired end state is software that may compete with, interoperate with, or provide similar capabilities to existing products while remaining independently engineered.

Success means:

```text
feature parity where useful
+
original implementation
+
original identity
+
traceable provenance
+
license compliance
```

not:

```text
maximum similarity to an existing proprietary application
```

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- When the Nx MCP server is available, use its tools to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---
name: expand
description: Use when the user asks to expand, elaborate, or explain the deep math, theory, system internals, or trade-offs behind a concept or codebase mechanism.
---

# Deep Dive & Theoretical Expansion

When triggered (explicitly via `@expand` or when the user says "expand on...", "explain the math behind...", or "how does this actually work under the hood?"), shift gears into a focused, insightful technical deep-dive.

### Guidelines
1. **Unpack the Core Mechanism**:
   - Don't just stay on the surface syntax. Explain the underlying mechanics: memory layout, mathematical equations, GPU/hardware pipeline, network protocols, or algorithmic complexity ($O(n)$, cache locality, etc.).
   - If math is involved (e.g., quaternions, 3D covariance, spherical harmonics, backprop gradients), write out the key relationships and intuition simply.

2. **Ground it in the Practical Code**:
   - Tie the abstract theory directly back to the files, structs, or functions currently in the project.
   - Show how the mathematical or theoretical constraint dictated the implementation choices.

3. **Interview & Senior Perspective**:
   - Explain what separates a junior answer from a staff-level answer when discussing this topic.
   - Highlight subtle traps, edge cases, or failure modes (e.g., NaN divergence in rasterization, floating point drift, memory bottlenecks).

4. **Tone**:
   - Engaging, clear, and direct. Avoid academic fluff, but respect the complexity.
   - Wrap up with a crisp summary takeaway and offer to resume coding whenever the user is ready.

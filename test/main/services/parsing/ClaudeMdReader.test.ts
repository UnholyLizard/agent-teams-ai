import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readAllClaudeMdFiles,
  readDirectoryClaudeMd,
} from '@main/services/parsing/ClaudeMdReader';

describe('ClaudeMdReader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads AGENTS.md and GEMINI.md in project root when present', async () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Agents Guide\nInstructions for agents');
    fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Gemini Rules\nRules for Gemini');

    const result = await readAllClaudeMdFiles(tmpDir);

    const projectAgents = result.files.get('project-agents');
    expect(projectAgents?.exists).toBe(true);
    expect(projectAgents?.charCount).toBeGreaterThan(0);
    expect(projectAgents?.estimatedTokens).toBeGreaterThan(0);

    const projectGemini = result.files.get('project-gemini');
    expect(projectGemini?.exists).toBe(true);
    expect(projectGemini?.charCount).toBeGreaterThan(0);
    expect(projectGemini?.estimatedTokens).toBeGreaterThan(0);
  });

  it('reads .agents/rules and .gemini/rules directory md files', async () => {
    const agentsRulesDir = path.join(tmpDir, '.agents', 'rules');
    fs.mkdirSync(agentsRulesDir, { recursive: true });
    fs.writeFileSync(path.join(agentsRulesDir, 'rule1.md'), '# Rule 1\nAlways write tests');

    const geminiRulesDir = path.join(tmpDir, '.gemini', 'rules');
    fs.mkdirSync(geminiRulesDir, { recursive: true });
    fs.writeFileSync(path.join(geminiRulesDir, 'rule2.md'), '# Rule 2\nBe precise');

    const result = await readAllClaudeMdFiles(tmpDir);

    const agentsRules = result.files.get('project-agents-rules');
    expect(agentsRules?.exists).toBe(true);
    expect(agentsRules?.charCount).toBeGreaterThan(0);

    const geminiRules = result.files.get('project-gemini-rules');
    expect(geminiRules?.exists).toBe(true);
    expect(geminiRules?.charCount).toBeGreaterThan(0);
  });

  it('reports non-existent rules files as exists: false', async () => {
    const result = await readAllClaudeMdFiles(tmpDir);

    const projectAgents = result.files.get('project-agents');
    expect(projectAgents?.exists).toBe(false);
    expect(projectAgents?.charCount).toBe(0);
    expect(projectAgents?.estimatedTokens).toBe(0);

    const projectGemini = result.files.get('project-gemini');
    expect(projectGemini?.exists).toBe(false);
  });

  describe('readDirectoryClaudeMd', () => {
    it('prefers CLAUDE.md if present', async () => {
      fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude');
      fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Agents');

      const info = await readDirectoryClaudeMd(tmpDir);
      expect(info.exists).toBe(true);
      expect(info.path).toBe(path.join(tmpDir, 'CLAUDE.md'));
    });

    it('falls back to AGENTS.md if CLAUDE.md is absent', async () => {
      fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Agents');

      const info = await readDirectoryClaudeMd(tmpDir);
      expect(info.exists).toBe(true);
      expect(info.path).toBe(path.join(tmpDir, 'AGENTS.md'));
    });

    it('falls back to GEMINI.md if CLAUDE.md and AGENTS.md are absent', async () => {
      fs.writeFileSync(path.join(tmpDir, 'GEMINI.md'), '# Gemini');

      const info = await readDirectoryClaudeMd(tmpDir);
      expect(info.exists).toBe(true);
      expect(info.path).toBe(path.join(tmpDir, 'GEMINI.md'));
    });

    it('returns exists: false when none are present', async () => {
      const info = await readDirectoryClaudeMd(tmpDir);
      expect(info.exists).toBe(false);
    });
  });
});

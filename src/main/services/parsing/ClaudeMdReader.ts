/**
 * ClaudeMdReader service - Reads CLAUDE.md files and calculates token counts.
 *
 * Responsibilities:
 * - Read CLAUDE.md files from various locations
 * - Calculate character counts and estimate token counts
 * - Handle file not found gracefully
 * - Support tilde (~) expansion to home directory
 */

import { encodePath, getClaudeBasePath, getHomeDir } from '@main/utils/pathDecoder';
import { countTokens } from '@main/utils/tokenizer';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import { LocalFileSystemProvider } from '../infrastructure/LocalFileSystemProvider';

import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';

const logger = createLogger('Service:ClaudeMdReader');

const defaultProvider = new LocalFileSystemProvider();

// ===========================================================================
// Types
// ===========================================================================

export interface ClaudeMdFileInfo {
  path: string;
  exists: boolean;
  charCount: number;
  estimatedTokens: number; // charCount / 4
}

export interface ClaudeMdReadResult {
  files: Map<string, ClaudeMdFileInfo>;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Expands tilde (~) in a path to the actual home directory.
 * @param filePath - Path that may contain ~
 * @returns Expanded path with ~ replaced by home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    const homeDir = getHomeDir();
    return path.join(homeDir, filePath.slice(1));
  }
  return filePath;
}

// ===========================================================================
// Main Functions
// ===========================================================================

/**
 * Reads a single CLAUDE.md file and returns its info.
 * @param filePath - Path to the CLAUDE.md file (supports ~ expansion)
 * @param fsProvider - Optional filesystem provider (defaults to local)
 * @returns ClaudeMdFileInfo with file details
 */
async function readClaudeMdFile(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ClaudeMdFileInfo> {
  const expandedPath = expandTilde(filePath);

  try {
    if (!(await fsProvider.exists(expandedPath))) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const content = await fsProvider.readFile(expandedPath);
    const charCount = content.length;
    const estimatedTokens = countTokens(content);

    return {
      path: expandedPath,
      exists: true,
      charCount,
      estimatedTokens,
    };
  } catch (error) {
    // Handle permission denied, file not readable, etc.
    logger.error(`Error reading CLAUDE.md file at ${expandedPath}:`, error);
    return {
      path: expandedPath,
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    };
  }
}

/**
 * Reads all .md files in a directory and returns combined info.
 * Used for project rules directory.
 * @param dirPath - Path to the directory (supports ~ expansion)
 * @param fsProvider - Optional filesystem provider (defaults to local)
 * @returns ClaudeMdFileInfo with combined stats from all .md files
 */
async function readDirectoryMdFiles(
  dirPath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ClaudeMdFileInfo> {
  const expandedPath = expandTilde(dirPath);

  try {
    if (!(await fsProvider.exists(expandedPath))) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const stats = await fsProvider.stat(expandedPath);
    if (!stats.isDirectory()) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    const mdFiles = await collectMdFiles(expandedPath, fsProvider);

    if (mdFiles.length === 0) {
      return {
        path: expandedPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }

    let totalCharCount = 0;
    const allContent: string[] = [];

    for (const filePath of mdFiles) {
      try {
        const content = await fsProvider.readFile(filePath);
        totalCharCount += content.length;
        allContent.push(content);
      } catch {
        // Skip files we can't read
        continue;
      }
    }

    // Count tokens on combined content for accuracy
    const estimatedTokens = countTokens(allContent.join('\n'));

    return {
      path: expandedPath,
      exists: true,
      charCount: totalCharCount,
      estimatedTokens,
    };
  } catch (error) {
    logger.error(`Error reading directory ${expandedPath}:`, error);
    return {
      path: expandedPath,
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    };
  }
}

/**
 * Recursively collect all .md files in a directory tree.
 */
async function collectMdFiles(
  dir: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<string[]> {
  const mdFiles: string[] = [];
  try {
    const entries = await fsProvider.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(fullPath);
        } else if (entry.isDirectory()) {
          mdFiles.push(...(await collectMdFiles(fullPath, fsProvider)));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Directory not readable
  }
  return mdFiles;
}

/**
 * Returns the platform-specific enterprise CLAUDE.md path.
 */
function getEnterprisePath(): string {
  switch (process.platform) {
    case 'win32':
      return 'C:\\Program Files\\ClaudeCode\\CLAUDE.md';
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/CLAUDE.md';
    default:
      return '/etc/claude-code/CLAUDE.md';
  }
}

/**
 * Reads auto memory MEMORY.md file for a project.
 * Only reads the first 200 lines, matching Claude Code behavior.
 */
async function readAutoMemoryFile(
  projectRoot: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ClaudeMdFileInfo> {
  const expandedRoot = expandTilde(projectRoot);
  const encoded = encodePath(expandedRoot);
  const memoryPath = path.join(getClaudeBasePath(), 'projects', encoded, 'memory', 'MEMORY.md');

  try {
    if (!(await fsProvider.exists(memoryPath))) {
      return { path: memoryPath, exists: false, charCount: 0, estimatedTokens: 0 };
    }

    const content = await fsProvider.readFile(memoryPath);
    // Only first 200 lines, matching Claude Code behavior
    const lines = content.split('\n');
    const truncated = lines.slice(0, 200).join('\n');
    const charCount = truncated.length;
    const estimatedTokens = countTokens(truncated);

    return { path: memoryPath, exists: true, charCount, estimatedTokens };
  } catch (error) {
    logger.error(`Error reading auto memory at ${memoryPath}:`, error);
    return { path: memoryPath, exists: false, charCount: 0, estimatedTokens: 0 };
  }
}

/**
 * Reads all potential CLAUDE.md locations for a project.
 * @param projectRoot - The root directory of the project
 * @param fsProvider - Optional filesystem provider (defaults to local)
 * @returns ClaudeMdReadResult with Map of path -> ClaudeMdFileInfo
 */
export async function readAllClaudeMdFiles(
  projectRoot: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ClaudeMdReadResult> {
  const files = new Map<string, ClaudeMdFileInfo>();
  const expandedProjectRoot = expandTilde(projectRoot);

  // 1. Enterprise CLAUDE.md (platform-specific path)
  const enterprisePath = getEnterprisePath();
  files.set('enterprise', await readClaudeMdFile(enterprisePath, fsProvider));

  // 2. User memory: <Claude root>/CLAUDE.md
  const userMemoryPath = path.join(getClaudeBasePath(), 'CLAUDE.md');
  files.set('user', await readClaudeMdFile(userMemoryPath, fsProvider));

  // User memory (Gemini): ~/.gemini/GEMINI.md
  const userGeminiPath = path.join(getHomeDir(), '.gemini', 'GEMINI.md');
  files.set('user-gemini', await readClaudeMdFile(userGeminiPath, fsProvider));

  // 3. Project memory: ${projectRoot}/CLAUDE.md
  const projectMemoryPath = path.join(expandedProjectRoot, 'CLAUDE.md');
  files.set('project', await readClaudeMdFile(projectMemoryPath, fsProvider));

  // Project memory (AGENTS.md): ${projectRoot}/AGENTS.md
  const projectAgentsPath = path.join(expandedProjectRoot, 'AGENTS.md');
  files.set('project-agents', await readClaudeMdFile(projectAgentsPath, fsProvider));

  // Project memory (GEMINI.md): ${projectRoot}/GEMINI.md
  const projectGeminiPath = path.join(expandedProjectRoot, 'GEMINI.md');
  files.set('project-gemini', await readClaudeMdFile(projectGeminiPath, fsProvider));

  // 4. Project memory alt: ${projectRoot}/.claude/CLAUDE.md
  const projectMemoryAltPath = path.join(expandedProjectRoot, '.claude', 'CLAUDE.md');
  files.set('project-alt', await readClaudeMdFile(projectMemoryAltPath, fsProvider));

  // 5. Project rules: ${projectRoot}/.claude/rules/*.md
  const projectRulesPath = path.join(expandedProjectRoot, '.claude', 'rules');
  files.set('project-rules', await readDirectoryMdFiles(projectRulesPath, fsProvider));

  // Project rules (.agents): ${projectRoot}/.agents/rules/*.md
  const projectAgentsRulesPath = path.join(expandedProjectRoot, '.agents', 'rules');
  files.set('project-agents-rules', await readDirectoryMdFiles(projectAgentsRulesPath, fsProvider));

  // Project rules (.gemini): ${projectRoot}/.gemini/rules/*.md
  const projectGeminiRulesPath = path.join(expandedProjectRoot, '.gemini', 'rules');
  files.set('project-gemini-rules', await readDirectoryMdFiles(projectGeminiRulesPath, fsProvider));

  // 6. Project local: ${projectRoot}/CLAUDE.local.md
  const projectLocalPath = path.join(expandedProjectRoot, 'CLAUDE.local.md');
  files.set('project-local', await readClaudeMdFile(projectLocalPath, fsProvider));

  // 7. User rules: <Claude root>/rules/**/*.md
  const userRulesPath = path.join(getClaudeBasePath(), 'rules');
  files.set('user-rules', await readDirectoryMdFiles(userRulesPath, fsProvider));

  // User rules (Gemini): ~/.gemini/config/rules/**/*.md
  const userGeminiRulesPath = path.join(getHomeDir(), '.gemini', 'config', 'rules');
  files.set('user-gemini-rules', await readDirectoryMdFiles(userGeminiRulesPath, fsProvider));

  // 8. Auto memory: ~/.claude/projects/<encoded>/memory/MEMORY.md
  files.set('auto-memory', await readAutoMemoryFile(projectRoot, fsProvider));

  return { files };
}

/**
 * Reads a specific directory's rule file (CLAUDE.md, AGENTS.md, or GEMINI.md).
 * Used for directory-specific rule files detected from file reads.
 * @param dirPath - Path to the directory (supports ~ expansion)
 * @param fsProvider - Optional filesystem provider (defaults to local)
 * @returns ClaudeMdFileInfo for the detected rule file in that directory
 */
export async function readDirectoryClaudeMd(
  dirPath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ClaudeMdFileInfo> {
  const expandedDirPath = expandTilde(dirPath);
  const candidates = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
  for (const candidate of candidates) {
    const candidatePath = path.join(expandedDirPath, candidate);
    const info = await readClaudeMdFile(candidatePath, fsProvider);
    if (info.exists) {
      return info;
    }
  }
  const claudeMdPath = path.join(expandedDirPath, 'CLAUDE.md');
  return readClaudeMdFile(claudeMdPath, fsProvider);
}

import { promises as fs } from 'fs';
import { join } from 'path';
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match)
        return { meta: {}, body: raw };
    const meta = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            meta[key] = val;
        }
    }
    return { meta, body: match[2] };
}
export async function loadSkills(skillsDir = './skills') {
    try {
        const files = await fs.readdir(skillsDir);
        const skills = [];
        for (const file of files) {
            if (!file.endsWith('.md'))
                continue;
            try {
                const raw = await fs.readFile(join(skillsDir, file), 'utf-8');
                const { meta, body } = parseFrontmatter(raw);
                const name = meta.name || file.replace(/\.md$/, '');
                skills.push({
                    name,
                    description: meta.description || '',
                    content: body.trim(),
                    filename: file,
                });
            }
            catch {
                // Skip unreadable skill files
            }
        }
        return skills;
    }
    catch {
        return [];
    }
}
export function buildSkillPrompt(activeSkills) {
    if (activeSkills.length === 0)
        return '';
    const parts = activeSkills.map(s => `[Skill: ${s.name}]\n${s.content}`);
    return '\n\n' + parts.join('\n\n');
}
export function buildSkillCatalog(skills) {
    if (skills.length === 0)
        return '(No skills available)';
    return skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
}

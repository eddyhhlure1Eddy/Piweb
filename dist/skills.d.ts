export interface Skill {
    name: string;
    description: string;
    content: string;
    filename: string;
}
export declare function loadSkills(skillsDir?: string): Promise<Skill[]>;
export declare function buildSkillPrompt(activeSkills: Skill[]): string;
export declare function buildSkillCatalog(skills: Skill[]): string;

import { http, HttpResponse } from 'msw';
import type { Skill, SkillLocation } from '@/types/prompt';
import { resolveMockDataProfile } from './mockConfig';

const demoLocation: SkillLocation = {
    id: 'mock-skills-claude',
    name: 'Demo Claude Code skills',
    path: '/home/demo/.claude/skills',
    ide_source: 'claude_code',
    is_installed: true,
    skill_count: 1,
};

// These handlers simulate a local catalog; they never read or write host files.
export const createSkillHandlers = (profile = resolveMockDataProfile()) => {
    const locations: SkillLocation[] = profile === 'newcomer' ? [] : [{ ...demoLocation }];
    const skillsFor = (location: SkillLocation): Skill[] => location.path === demoLocation.path ? [{
        id: `${location.id}:getting-started`,
        location_id: location.id,
        name: 'Getting started',
        description: 'A sample skill for exploring the mock catalog.',
        path: `${location.path}/getting-started/SKILL.md`,
        filename: 'SKILL.md',
        file_type: 'markdown',
        content: '---\nname: getting-started\ndescription: Explore the mock skill catalog\n---\n\n# Getting started\n\nUse this sample to preview skill content without accessing local files.\n',
    }] : [];
    const notFound = () => HttpResponse.json({ success: false, error: 'Skill location not found' }, { status: 404 });

    return [
        http.get('/api/v2/skill-locations', () => HttpResponse.json({ success: true, data: locations })),
        http.post('/api/v2/skill-locations', async ({ request }) => {
            const body = await request.json() as Partial<SkillLocation>;
            if (!body.name?.trim() || !body.path?.trim() || !body.ide_source) {
                return HttpResponse.json({ success: false, error: 'Name, path and IDE source are required' }, { status: 400 });
            }
            const location: SkillLocation = {
                id: crypto.randomUUID(), name: body.name.trim(), path: body.path.trim(),
                ide_source: body.ide_source, skill_count: 0,
            };
            location.skill_count = skillsFor(location).length;
            locations.push(location);
            return HttpResponse.json({ success: true, data: location });
        }),
        http.delete('/api/v2/skill-locations/:id', ({ params }) => {
            const index = locations.findIndex(location => location.id === params.id);
            if (index < 0) return notFound();
            locations.splice(index, 1);
            return HttpResponse.json({ success: true });
        }),
        http.post('/api/v2/skill-locations/:id/refresh', ({ params }) => {
            const location = locations.find(location => location.id === params.id);
            if (!location) return notFound();
            const skills = skillsFor(location);
            location.skill_count = skills.length;
            location.last_scanned_at = new Date().toISOString();
            return HttpResponse.json({ success: true, data: { location_id: location.id, skills } });
        }),
        http.get('/api/v2/skill-locations/discover', () => HttpResponse.json({ success: true, data: {
            ides_found: ['claude_code'], total_ides_scanned: 1, skills_found: 1,
            locations: [{ ...demoLocation, is_auto_discovered: true }],
        } })),
        http.post('/api/v2/skill-locations/import', async ({ request }) => {
            const body = await request.json() as { locations?: SkillLocation[] };
            if (!Array.isArray(body.locations) || body.locations.some(location => !location.name?.trim() || !location.path?.trim() || !location.ide_source)) {
                return HttpResponse.json({ success: false, error: 'Valid skill locations are required' }, { status: 400 });
            }
            const imported = body.locations.map(candidate => {
                const existing = locations.find(location => location.path === candidate.path && location.ide_source === candidate.ide_source);
                if (existing) return existing;
                const location: SkillLocation = { ...candidate, id: crypto.randomUUID(), skill_count: 0 };
                location.skill_count = skillsFor(location).length;
                locations.push(location);
                return location;
            });
            return HttpResponse.json({ success: true, data: imported });
        }),
        http.get('/api/v2/skill-content', ({ request }) => {
            const query = new URL(request.url).searchParams;
            const location = locations.find(location => location.id === query.get('location_id'));
            if (!location) return notFound();
            const skill = skillsFor(location).find(skill => query.get('skill_id')
                ? skill.id === query.get('skill_id') : skill.path === query.get('skill_path'));
            if (!skill) return HttpResponse.json({ success: false, error: 'Skill not found' }, { status: 404 });
            return HttpResponse.json({ success: true, data: skill });
        }),
    ];
};

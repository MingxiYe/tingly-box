import { http, HttpResponse } from 'msw';

let config = {
    http_transport: {
        respect_env_proxy: false,
        global_proxy_url: '',
    },
};

export const systemHandlers = [
    http.get('/api/v1/config', () => HttpResponse.json({ success: true, data: config })),
    http.put('/api/v1/config', async ({ request }) => {
        const update = await request.json() as Partial<typeof config>;
        config = {
            ...config,
            http_transport: { ...config.http_transport, ...update.http_transport },
        };
        return HttpResponse.json({ success: true, data: config });
    }),
];

const WorkersSentry = require('workers-sentry/worker');
const parser = require('cron-parser');
const data = require('./data.yml');

// Util to send a text response
const textResponse = content => new Response(content, {
    headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
    },
});

// Util to send a JSON response
const jsonResponse = obj => new Response(JSON.stringify(obj), {
    headers: {
        'Content-Type': 'application/json',
    },
});

// Process all requests to the worker
const handleRequest = async ({ request, wait, sentry }) => {
    const url = new URL(request.url);

    // Health check route
    if (url.pathname === '/health') return textResponse('OK');

    // Get jobs route
    if (url.pathname === '/jobs') return jsonResponse(data);

    // Execute triggers route
    if (url.pathname === '/execute') {
        // Iterate over each workflow and each cron within
        const toTrigger = [];
        for (const workflow of data.workflows) {
            for (const cron of workflow.cron) {
                // Determine if the cron should trigger within a 1 minute bubble of now
                const now = new Date();
                const options = {
                    currentDate: new Date(now.getTime() - 30 * 1000),
                    endDate: new Date(now.getTime() + 30 * 1000),
                    iterator: false,
                };
                const interval = parser.parseExpression(cron, options);

                // If it should trigger, do something
                if (interval.hasNext()) {
                    toTrigger.push({
                        owner: workflow.owner,
                        repo: workflow.repo,
                        workflow: workflow.workflow,
                        cron,
                    });
                }
            }
        }

        // Trigger each workflow in the background after
        wait((async () => {
            // TODO
        })());

        // Return the jobs we're going to run
        return jsonResponse(toTrigger);
    }

    // Not found
    return new Response(null, { status: 404 });
};

// Register the worker listener
addEventListener('fetch', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    try {
        return event.respondWith(handleRequest({ request: event.request, wait: event.waitUntil.bind(event), sentry }));
    } catch (err) {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }
});


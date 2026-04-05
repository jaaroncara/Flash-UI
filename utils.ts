/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

import { Artifact } from './types';

export const generateExportHtml = (artifacts: Artifact[]) => {
    const iframes = artifacts.map(a => {
        const encodedHtml = a.html.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        return `<div class="artifact-container">
            <div class="artifact-header">${a.styleName || 'Artifact'}</div>
            <iframe srcdoc="${encodedHtml}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-presentation allow-same-origin"></iframe>
        </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flash UI Export</title>
<style>
    body {
        margin: 0;
        padding: 20px;
        background: #050505;
        color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        gap: 40px;
        align-items: center;
    }
    .artifact-container {
        width: 100%;
        max-width: 1200px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .artifact-header {
        font-size: 14px;
        color: #a1a1aa;
        text-transform: uppercase;
        letter-spacing: 0.1em;
    }
    iframe {
        width: 100%;
        height: 600px;
        border: 1px solid #27272a;
        border-radius: 4px;
        background: #fff; /* or match your generated themes */
    }
</style>
</head>
<body>
    <h1>Flash UI Collection Export</h1>
    ${iframes}
</body>
</html>`;
};
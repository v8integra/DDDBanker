/**
 * First import on every page. Fonts are self-hosted (no requests to Google,
 * and the CSP stays 'self'), and Zod runs jitless: its JIT probes `new
 * Function`, which the production CSP rightly blocks and reports.
 */
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/press-start-2p/400.css';
import { z } from 'zod';

z.config({ jitless: true });

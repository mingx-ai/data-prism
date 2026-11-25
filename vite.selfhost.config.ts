import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {resolve} from 'node:path';
export default defineConfig({root:'selfhost',publicDir:resolve('public'),plugins:[react()],resolve:{alias:{'@':resolve('.')}},css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:resolve('dist-selfhost/public'),emptyOutDir:true}});

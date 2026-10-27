import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { Api } from './data/api';
import { criarLocalApi } from './data/localApi';
import { criarSupabaseApi } from './data/supabaseApi';
import './styles/app.css';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Sem credenciais, o app abre em PRÉVIA LOCAL (dados fictícios, sem servidor), sempre sinalizada na tela.
const api: Api = url && chave ? criarSupabaseApi(url, chave) : criarLocalApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);

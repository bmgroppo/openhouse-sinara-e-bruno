

## Plano: Integrar Firecrawl na extração de produtos

O Firecrawl já foi conectado com sucesso e a `FIRECRAWL_API_KEY` está disponível nas Edge Functions.

### O que será feito

Reescrever a Edge Function `scrape-product` para usar o Firecrawl como método principal de extração, mantendo o fallback atual como backup.

### Fluxo de extração (novo)

```text
URL do produto
    │
    ▼
[1] Firecrawl API (scrape com JSON-LD + metadata)
    │
    ├── Sucesso → retorna título, preço, imagem
    │
    ▼
[2] Fallback: fetch direto + regex (código atual)
    │
    └── Retorna o que conseguir
```

### Detalhes técnicos

**Arquivo:** `supabase/functions/scrape-product/index.ts`

1. **Firecrawl como método principal:**
   - Chamar `https://api.firecrawl.dev/v1/scrape` com o URL do produto
   - Usar `formats: ['markdown']` para obter conteúdo renderizado (JavaScript executado)
   - Extrair título, preço e imagem dos `metadata` retornados (`metadata.title`, `metadata.ogImage`)
   - Usar regex no markdown retornado para extrair preço em formato BRL (`R$ X.XXX,XX`)

2. **Fallback mantido:**
   - Se Firecrawl falhar (sem API key, erro, ou dados incompletos), usar o método atual de fetch direto + regex

3. **Extração de dados do Firecrawl:**
   - `title` → `metadata.title` ou `metadata.ogTitle`
   - `image_url` → `metadata.ogImage`
   - `price` → regex no markdown para `R$` ou dos metadata quando disponível

4. **Deploy automático** da Edge Function atualizada

### Resultado esperado

- Amazon, Mercado Livre e Shopee terão extração confiável (Firecrawl renderiza JavaScript)
- Sites menores continuam funcionando via fallback
- Botão "Extrair" no admin retornará dados completos


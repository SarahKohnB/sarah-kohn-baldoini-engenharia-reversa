import { test, expect } from '@playwright/test';

test('Executar testes práticos na aplicação web', async ({ page }) => {
  
  // 1. Acesso à aplicação: acessar o endereço e verificar carregamento
  await page.goto('https://demo.playwright.dev/todomvc/#/');
  await expect(page).toHaveTitle(/TodoMVC/);

  // 5. Validação: verificar se o título principal da interface aparece corretamente
  const headerTitle = page.locator('h1');
  await expect(headerTitle).toHaveText('todos');

  // 3. Elementos gráficos & 4. Formulários: preencher campo e interagir
  const inputTarefa = page.locator('.new-todo');
  await inputTarefa.fill('Estudar Playwright para o laboratório');
  await inputTarefa.press('Enter');

  await inputTarefa.fill('Criar scripts de testes automáticos');
  await inputTarefa.press('Enter');

  // Valida que as 2 tarefas foram adicionadas na lista
  const itensLista = page.locator('.todo-list li');
  await expect(itensLista).toHaveCount(2);

  // Interagir com botão / checkbox para concluir a primeira tarefa
  const primeiroItemCheckbox = itensLista.nth(0).locator('.toggle');
  await primeiroItemCheckbox.check();

  // 2. Navegação: testar os links de filtro e verificar redirecionamento/comportamento
  const linkCompletados = page.locator('a[href="#/completed"]');
  await linkCompletados.click();

  // Valida se apenas a tarefa concluída está visível no filtro
  await expect(itensLista).toHaveCount(1);
  await expect(itensLista.first()).toHaveClass(/completed/);

  // 6. Captura de tela: gerar screenshot da página testada
  await page.screenshot({ path: 'screenshot-resultado.png', fullPage: true });
});
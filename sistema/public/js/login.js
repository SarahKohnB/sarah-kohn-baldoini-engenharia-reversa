const erro = document.getElementById('erro');

function mostrarErro(msg) {
    erro.textContent = msg;
    erro.style.display = 'block';
}

// veio redirecionado porque a sessão expirou
if (new URLSearchParams(location.search).get('expirou')) {
    mostrarErro('Sua sessão expirou. Faça login novamente.');
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.style.display = 'none';
    try {
        await api('/api/login', {
            method: 'POST',
            body: {
                login: document.getElementById('login').value,
                senha: document.getElementById('senha').value
            }
        });
        window.location.href = '/principal.html';
    } catch (err) {
        mostrarErro(err.message);   // falha de autenticação: informa e fica no login
    }
});
// script da tela de login. quando a pessoa clica em entrar, manda o usuário e a senha pro
//servidor e, se der certo, vai pra tela principal, e se der erro mostra a mensagem na própria tela
//também mostra o aviso de sessão expirada quando a pessoa foi mandada de volta pro login

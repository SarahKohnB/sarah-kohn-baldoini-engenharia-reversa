// server.js - recebe os pedidos das telas, confere se estão certos e conversa com o banco
// aqui ficam as rotas da API, as validações e as regras de negócio
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db/conexao');
const { criptografar, descriptografar } = require('./seguranca');

const app = express();
// aqui fica o tempo de expiração do login (30min), quando passar esse prazo o cookie expira e as rotas protegidas passam a responder 401, que no caso significa um erro, então o front vai direcionar o usuario para a tela de login novamente
const MINUTOS_SESSAO = 30;

// faz o servidor entender os dados que a tela envia em formato JSON
app.use(express.json());

// aqui vai configurar o login por sessão, ou seja, quando a pessoa entra, o servidor guarda quem ela é e entrega ao navegador só um cookie com um código e nas proximas chamadas o navegador manda esse código de volta e assim o servidor sabe quem está pedindo
app.use(session({
    secret: 'oficina-autocerta-sessao', // secret: é a "chave" usada para assinar o cookie, para ninguém conseguir inventar um, porém esta escrita direto no código e isso é um ponto fraco de segurança
    resave: false,
    saveUninitialized: false, // saveUninitialized false: só cria a sessão depois do login e não para quem apenas abriu a página
    cookie: { maxAge: MINUTOS_SESSAO * 60 * 1000, httpOnly: true } // httpOnly: o js da página não consegue ler o cookie
}));

// as páginas html são publicas entao qualquer pessoa consegue abrir sem fazer login, o que é protegido de verdade são os dados, nas rotas /api, que usam o exigirLogin.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

// se a sessão expirou (ou a pessoa não fez login) responde 401 no json, e quem manda o usuário pro login é a api() do comum.js
function exigirLogin(req, res, next) {
    if (!req.session.usuario) {
        return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    }
    next();
}

// ===================== LOGIN =====================
// Recebe o login e a senha digitados na tela
// Responde 200 se deu certo, 400 se faltou algum campo e 401 se o usuário ou a senha estiverem errados
app.post('/api/login', (req, res) => {
    const { login, senha } = req.body;
    if (!login || !senha) {
        return res.status(400).json({ erro: 'Informe usuário e senha.' });
    }
    const usuario = db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login.trim());
    // A senha guardada no banco não é a senha de verdade, é um hash (uma versão embaralhada que
    // não tem volta), o bcrypt transforma a senha digitada do mesmo jeito e compara com o hash do banco
    // A mensagem de erro é a mesma para usuário errado e senha errada, pra não revelar quais logins existem
    if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
        return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }
    // aqui a pessoa passa a estar "logada" e na sessão ficam só o id e o nome, nunca a senha
    req.session.usuario = { id: usuario.id, nome: usuario.nome };
    res.json({ ok: true });
});

// aqui é onde acontece o logout, que apaga a sessão no servidor. Sem isso, o cookie continuaria valendo até expirar
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', exigirLogin, (req, res) => res.json(req.session.usuario));

// ===================== CLIENTES =====================
// no banco o cpf fica criptografado (embaralhado), então ninguem consegue ler olhando a tabela
// Essa função pega o cliente do banco e desembaralha o cpf, para poder mostrar na tela
const clienteJson = c => ({ ...c, cpf: descriptografar(c.cpf) });

// Confere se os dados do cliente estão certos antes de salvar
// Se achar algum problema, devolve a mensagem de erro e se estiver tudo certo, devolve null
// É usada tanto no cadastro (POST) quanto na edição (PUT)
// O idAtual existe por causa da edição: quando editamos um cliente, o CPF dele não pode contar como "repetido" só porque ele mesmo já tem esse cpf
function validarCliente(corpo, idAtual) {
    const nome = (corpo.nome || '').trim();
    const cpf = String(corpo.cpf || '').replace(/\D/g, '');
    if (!nome) return 'Informe o nome do cliente.';
    // aqui só conta se tem 11 números, não confere se o CPF existe de verdade
    if (cpf.length !== 11) return 'O CPF deve ter 11 dígitos.';
    if (corpo.email && !/^\S+@\S+\.\S+$/.test(corpo.email)) return 'E-mail inválido.';
    // para saber se o cpf já foi cadastrado, nao dá para pedir para o banco procurar, porque o cpf está embaralhado e o mesmo cpf vira um texto diferente a cada vez que é embaralhado
    // então o código pega todos os clientes, desembaralha o cpf de cada um e compara com o novo.
    const repetido = db.prepare('SELECT * FROM clientes').all()
        .some(c => c.id !== idAtual && descriptografar(c.cpf) === cpf);
    if (repetido) return 'Já existe um cliente com este CPF.';
    return null;
}

// Lista os clientes em ordem de nome, entao se vier um texto na busca, mostra só os clientes que tem esse texto no nome, e-mail, telefone ou no cpf.
app.get('/api/clientes', exigirLogin, (req, res) => {
    const termo = (req.query.busca || '').trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    const lista = db.prepare('SELECT * FROM clientes ORDER BY nome').all().map(clienteJson);
    // o CPF está criptografado no banco, então a busca é feita depois de descriptografar
    res.json(lista.filter(c => !termo
        || c.nome.toLowerCase().includes(termo)
        || (c.email || '').toLowerCase().includes(termo)
        || (c.telefone || '').includes(termo)
        || (digitos && c.cpf.includes(digitos))));
});

// aqui é onde cadastra um cliente novo
// Primeiro confere os dados com o validarCliente e se tiver erro, responde 400 com a mensagem
// se estiver tudo certo, embaralha o CPF (só os números) e salva
app.post('/api/clientes', exigirLogin, (req, res) => {
    const erro = validarCliente(req.body, null);
    if (erro) return res.status(400).json({ erro });
    const { nome, cpf, telefone, email } = req.body;
    db.prepare('INSERT INTO clientes (nome, cpf, telefone, email) VALUES (?,?,?,?)')
        .run(nome.trim(), criptografar(String(cpf).replace(/\D/g, '')), telefone || '', email || '');
    res.status(201).json({ ok: true });
});

// aqui edita um cliente que já existe
// Primeiro vai ver se o cliente existe (se nao existir, responde 404). Depois confere os dados do mesmo jeito do cadastro e atualiza
app.put('/api/clientes/:id', exigirLogin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(id)) {
        return res.status(404).json({ erro: 'Cliente não encontrado.' });
    }
    const erro = validarCliente(req.body, id);
    if (erro) return res.status(400).json({ erro });
    const { nome, cpf, telefone, email } = req.body;
    db.prepare('UPDATE clientes SET nome=?, cpf=?, telefone=?, email=? WHERE id=?')
        .run(nome.trim(), criptografar(String(cpf).replace(/\D/g, '')), telefone || '', email || '', id);
    res.json({ ok: true });
});

// ===================== VEÍCULOS =====================
// aceita placa antiga (ABC1234) e Mercosul (ABC1D23)
// o formato é: 3 letras, 1 número, 1 letra ou numero, e 2 numeros
const PLACA_VALIDA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

// aqui vai lista os veiculos junto com o nome do dono
// o JOIN junta a tabela de veiculos com a de clientes pelo cliente_id, assim a tela já recebe o nome do cliente sem precisar fazer outra busca
app.get('/api/veiculos', exigirLogin, (req, res) => {
    res.json(db.prepare(`
        SELECT v.*, c.nome AS cliente_nome
        FROM veiculos v JOIN clientes c ON c.id = v.cliente_id
        ORDER BY v.modelo`).all());
});

// aqui cadastra um veículo
// um veiculo não pode ficar sem cliente, e isso é garantido em duas partes:
//  1. No servidor (aqui) porque o cliente é obrigatório e precisa existir.
//  2. No banco porque ele recusa veículo sem cliente ou com um cliente que não existe (é a FOREIGN KEY do banco, e o conexao.js ainda garante que ela esteja ligada com a linha PRAGMA foreign_keys = ON)
app.post('/api/veiculos', exigirLogin, (req, res) => {
    const { modelo, tipo, marca, cliente_id } = req.body;
    // limpa a placa antes de conferir: tira espaço e hífen e deixa em maiúsculo
    // assim "abc-1d23" e "ABC1D23" viram a mesma placa
    const placa = String(req.body.placa || '').replace(/[\s-]/g, '').toUpperCase();
    if (!PLACA_VALIDA.test(placa)) return res.status(400).json({ erro: 'Informe uma placa válida.' });
    if (!modelo || !modelo.trim()) return res.status(400).json({ erro: 'Informe o modelo do veículo.' });
    if (!tipo || !tipo.trim()) return res.status(400).json({ erro: 'Informe o tipo do veículo.' });
    // o 0 que a tela manda quando não escolhem cliente conta como vazio aqui
    if (!cliente_id) return res.status(400).json({ erro: 'Selecione o cliente do veículo.' });
    if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(cliente_id)) {
        return res.status(400).json({ erro: 'Cliente não encontrado.' });
    }
    // não deixa cadastrar duas placas iguais
    if (db.prepare('SELECT id FROM veiculos WHERE placa = ?').get(placa)) {
        return res.status(400).json({ erro: 'Já existe um veículo com esta placa.' });
    }
    db.prepare('INSERT INTO veiculos (placa, modelo, tipo, marca, cliente_id) VALUES (?,?,?,?,?)')
        .run(placa, modelo.trim(), tipo.trim(), (marca || '').trim(), cliente_id);
    res.status(201).json({ ok: true });
});

// ===================== AGENDAMENTOS =====================
// Confere se a data é uma data de verdade, no formato ano-mês-dia (2026-10-25)
// porem só conferir o formato não basta, 2026-02-31 tem o formato certo, mas essa data não existe, por isso o código cria a data e compara com o texto que veio. O JavaScript "conserta" o 31 de fevereiro para 3 de março, e como o resultado fica diferente do que foi enviado, a data é recusada.
function dataValida(texto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) return false;
    const d = new Date(texto + 'T00:00:00');
    return !isNaN(d) && d.toISOString().slice(0, 10) === texto;
}

// Lista os agendamentos com os dados do veiculo e do cliente (junta as 3 tabelas)
// O ORDER BY deixa a lista em ordem de mês e dentro do mês, em ordem de data.
// quem coloca o título de cada mês na tela é o agendamentos.js, que escreve um título novo sempre que o mês muda, por isso a lista precisa chegar já ordenada.
// e tambem o cpf que vem embaralhado do banco é desembaralhado aqui antes de enviar
app.get('/api/agendamentos', exigirLogin, (req, res) => {
    const lista = db.prepare(`
        SELECT a.id, a.data_agendamento, a.servico,
               v.placa, v.modelo AS veiculo_modelo, v.tipo, v.marca,
               c.nome AS cliente_nome, c.cpf AS cliente_cpf, c.telefone, c.email
        FROM agendamentos a
        JOIN veiculos v ON v.id = a.veiculo_id
        JOIN clientes c ON c.id = v.cliente_id
        ORDER BY strftime('%Y-%m', a.data_agendamento), a.data_agendamento`).all();
    res.json(lista.map(a => ({ ...a, cliente_cpf: descriptografar(a.cliente_cpf) })));
});

// cria um agendamento
// confere se o veículo existe, se a data é válida e se o serviço foi preenchido
app.post('/api/agendamentos', exigirLogin, (req, res) => {
    const { veiculo_id, data_agendamento, servico } = req.body;
    if (!veiculo_id || !db.prepare('SELECT id FROM veiculos WHERE id = ?').get(veiculo_id)) {
        return res.status(400).json({ erro: 'Selecione um veículo.' });
    }
    if (!dataValida(data_agendamento)) return res.status(400).json({ erro: 'Informe uma data válida.' });
    if (!servico || !servico.trim()) return res.status(400).json({ erro: 'Informe o serviço.' });
    db.prepare('INSERT INTO agendamentos (veiculo_id, data_agendamento, servico) VALUES (?,?,?)')
        .run(veiculo_id, data_agendamento, servico.trim());
    res.status(201).json({ ok: true });
});

// aqui permite mudar a data de um agendamento e só a data pode ser alterada, o veiculo e o serviço continuam os mesmos
app.put('/api/agendamentos/:id', exigirLogin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM agendamentos WHERE id = ?').get(id)) {
        return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    }
    if (!dataValida(req.body.data_agendamento)) {
        return res.status(400).json({ erro: 'Informe uma data válida.' });
    }
    db.prepare('UPDATE agendamentos SET data_agendamento = ? WHERE id = ?')
        .run(req.body.data_agendamento, id);
    res.json({ ok: true });
});

app.listen(3000, () => console.log('Servidor rodando em http://localhost:3000'));

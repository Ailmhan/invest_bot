const { Telegraf } = require('telegraf');
const { RestClientV5 } = require('bybit-api');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf('7694894685:AAHk2iyUkPQL88WlLOMGhLu9V3wYNtqeVkI'); // Токен вашего бота
const client = new RestClientV5({
    testnet: false,
    key: 'M9Ij8JVClje4j3ysz9', // API ключ Bybit
    secret: '7CYaBFCQHN0gtjOgd6zkUBFPTiMQSQtlurha', // Секретный ключ Bybit
});

const trc20WalletAddress = 'TLzvkvzzyMFCaNq7L1AW6VGstspVEf2Mrz'; // Ваш TRC-20 адрес кошелька
const db = new sqlite3.Database('./database.db');

// Инициализация базы данных Привет мир, сейчас я начинаю свою активную деятельность. В данный момент я планирую реализовать кучу крутых проектов.
// Нужно опять пприучить себя каку пользоваться данной клавиатурой. В Частности после этого мои мозг начнет реально быстро использовать все свои возможности. \
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        userId INTEGER PRIMARY KEY,
        totalDeposits REAL DEFAULT 0,
        monthlyIncome REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        username TEXT,
        password TEXT,
        userId INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY,
        userId INTEGER,
        amount REAL,
        walletAddress TEXT,
        status TEXT DEFAULT 'pending',
        date TEXT,
        FOREIGN KEY(userId) REFERENCES users(userId)
    )`);
});

// Функция для проверки депозита
async function checkDeposit(amount) {
    const oneHourAgo = Date.now() - 3600000; // Проверяем транзакции за последний час
    const endTime = Date.now();

    try {
        const response = await client.getDepositRecords({
            coin: 'USDT',
            startTime: oneHourAgo,
            endTime: endTime,
        });

        if (response.retCode === 0) {
            const deposits = response.result.rows;

            for (const deposit of deposits) {
                if (parseFloat(deposit.amount) === amount && deposit.status === 3) { // статус 3 = успешный
                    return true;
                }
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке депозита:', error);
    }

    return false;
}

// Команда старт
bot.start((ctx) => {
    const menu = {
        reply_markup: {
            keyboard: [
                [{ text: 'Инвестировать' }, { text: 'Мой доход' }],
                [{ text: 'Запросить вывод' }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
        },
    };
    ctx.reply('Добро пожаловать! Выберите действие:', menu);
});

// Инвестиционная команда
bot.hears('Инвестировать', (ctx) => {
    ctx.reply('Введите сумму для инвестирования:');
    bot.on('text', async (msg) => {
        const amount = parseFloat(msg.message.text);
        const userId = msg.from.id;

        if (isNaN(amount) || amount <= 0) {
            return msg.reply('Пожалуйста, введите корректную сумму.');
        }

        const isDepositConfirmed = await checkDeposit(amount);
        if (!isDepositConfirmed) {
            return msg.reply('Ваш депозит еще не подтвержден. Пожалуйста, система проверяет все начисленные деползиты за последини час. Если сумма пополнится вам будет отправлено уведомление ,в случае отсутствия уведомления в течении часа указанная сумма не была вами пополнина на указанный кошелек');
        }

        db.run('INSERT OR IGNORE INTO users (userId, totalDeposits) VALUES (?, ?)', [userId, 0]);
        db.get('SELECT totalDeposits FROM users WHERE userId = ?', [userId], (err, row) => {
            if (err) return msg.reply('Ошибка базы данных.');

            const totalDeposits = row ? row.totalDeposits : 0;
            const newTotalDeposits = totalDeposits + amount;

            db.run('UPDATE users SET totalDeposits = ? WHERE userId = ?', [newTotalDeposits, userId]);
            msg.reply(`Ваш депозит успешно зарегистрирован: ${amount} USDT`);
        });
    });
});

// Мой доход
bot.hears('Мой доход', async (ctx) => {
    const userId = ctx.from.id;
    db.get('SELECT totalDeposits FROM users WHERE userId = ?', [userId], (err, row) => {
        if (err) return ctx.reply('Ошибка при получении данных.');

        const totalDeposits = row ? row.totalDeposits : 0;
        const monthlyIncome = totalDeposits * 0.04; // 4% от депозита
        const totalIncome = totalDeposits + monthlyIncome;

        ctx.reply(`Ваш доход составляет: ${totalIncome.toFixed(2)} USDT (включая 4% за месяц)`);
    });
});

// Запрос на вывод
bot.hears('Запросить вывод', (ctx) => {
    ctx.reply('Введите сумму для вывода:');
    bot.on('text', async (msg) => {
        const amount = parseFloat(msg.message.text);
        const userId = msg.from.id;

        if (isNaN(amount) || amount <= 0) {
            return msg.reply('Введите корректную сумму.');
        }

        db.get('SELECT totalDeposits FROM users WHERE userId = ?', [userId], (err, row) => {
            if (err) return msg.reply('Ошибка при получении данных.');

            const totalDeposits = row ? row.totalDeposits : 0;
            if (amount > totalDeposits) {
                return msg.reply('Недостаточно средств для вывода.');
            }

            msg.reply('Введите адрес вашего кошелька TRC-20:');
            bot.on('text', async (walletMsg) => {
                const walletAddress = walletMsg.message.text;

                db.run('INSERT INTO withdrawals (userId, amount, walletAddress, date) VALUES (?, ?, ?, ?)',
                    [userId, amount, walletAddress, new Date().toLocaleString()], (err) => {
                        if (err) return walletMsg.reply('Ошибка при запросе вывода.');

                        db.run('UPDATE users SET totalDeposits = totalDeposits - ? WHERE userId = ?', [amount, userId]);
                        walletMsg.reply('Запрос на вывод отправлен на рассмотрение.');
                        
                        notifyAdmins(`Запрос на вывод: Пользователь ID ${userId} запросил вывод ${amount} USDT на кошелек ${walletAddress}`);
                    });
            });
        });
    });
});

function notifyAdmins(message) {
    db.all('SELECT * FROM admins', [], (err, rows) => {
        if (err) return console.error('Ошибка при получении администраторов:', err);
        
        rows.forEach((admin) => {
            bot.telegram.sendMessage(admin.userId, message);
        });
    });
}

// Вход администратора
bot.command('admin', (ctx) => {
    ctx.reply('Введите логин и пароль (формат: логин пароль):');
    bot.on('text', async (msg) => {
        const [username, password] = msg.message.text.split(' ');

        db.get('SELECT * FROM admins WHERE username = ? AND password = ?', [username, password], (err, row) => {
            if (err) return msg.reply('Ошибка при проверке данных.');
            if (row) {
                msg.reply('Вы вошли как администратор. Теперь вы будете получать уведомления о запросах на вывод.');
                db.run('UPDATE admins SET userId = ? WHERE id = ?', [msg.from.id, row.id]);
            } else {
                msg.reply('Неверный логин или пароль.');
            }
        });
    });
});

bot.launch()
    .then(() => console.log('Бот запущен'))
    .catch((err) => console.error('Ошибка запуска бота:', err));

const mineflayer = require('mineflayer')

const bot = mineflayer.createBot({
  host: '10.167.131.135',
  port: 25572,
  username: 'bot_magma_farm',
  auth: 'offline',
  viewDistance: 1,
  checkTimeoutInterval: 60_000
})

bot.once('spawn', () => {
  bot.clearControlStates()
bot.chat('/tppos 727.7 92 11.5 world')
setTimeout(() => bot.chat('/skin url "https://minesk.in/7904d8b03d7546b196d91c3e0c84381c" classic'), 2000)
  setInterval(() => bot.clearControlStates(), 10_000) // ultra low CPU, no movement
})

bot.on('kicked', (r) => console.log('Kicked:', JSON.stringify(r, null, 4)))
bot.on('error', (e) => console.log('Error:', e))
bot.on('login', () => console.log('Logged in'))
bot.on('end', (reason) => console.log('Ended:', reason))
bot.on('disconnect', (packet) => console.log('Disconnect packet:', packet))
//bot.on('messagestr', (msg) => console.log('MSG:', msg))

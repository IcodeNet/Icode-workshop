import {createServer} from 'node:http'
import {message} from './message.mjs'
createServer((req,res)=>{res.setHeader('content-type','text/plain');res.end(message())}).listen(Number(process.env.PORT||4403),process.env.HOST||'127.0.0.1')

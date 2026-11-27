// A real third-party-shaped adapter, loaded explicitly by the host.
// Replace this relative import with @icodenet/workshop-adapter-api/process
// when packaging an independently installed adapter.
import {execute} from '../../packages/adapter-api/node.mjs'
export default {
 id:'custom-node',apiVersion:1,
 async detect(){return [{level:'info',message:'Custom Node runtime '+process.version}]},
 async prepare(){},
 async run(command,context){
  if(command!=='test')throw new Error('Unsupported command: '+command)
  return execute(process.execPath,['--test'],context)
 }
}

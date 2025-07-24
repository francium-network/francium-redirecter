import readline from 'node:readline'


async function getInput(question){
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(r=>{

    rl.question(question, name => {
        r(name)
        rl.close();
    });
    })
}

const websiteURL = await getInput("What website do you want to clone?\n")
let websiteRootUrl = new URL(websiteURL).origin

import express from 'express'

const app = express()
const PORT = 8908


app.listen(PORT, ()=>{
    console.log("Visit port "+PORT+" and continue the setup")
})
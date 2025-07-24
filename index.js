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

app.use(async(req,res,next)=>{
    let extReq = await fetch(websiteRootUrl+req.path)
    console.log(extReq.headers)
    res.set("content-type", extReq.headers.get("content-type"))
    res.status(extReq.status)
    res.send((await extReq.text()))
})

app.listen(PORT, ()=>{
    console.log("Please visit port: "+PORT+" This will scrape the site for needed assets")
})
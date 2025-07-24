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
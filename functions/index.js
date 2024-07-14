const { onRequest } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getAppCheck } = require('firebase-admin/app-check');

initializeApp();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

exports.analyzeImage = onRequest({cors:["https://geminihackathonkang.web.app"]}, async (req, res) => {
    // Verify the App Check token
    const appCheckToken = req.header('X-Firebase-AppCheck');
    if (!appCheckToken) {
        return res.status(401).json({ error: "Unauthorized: Missing App Check token" });
    }

    try {
        await getAppCheck().verifyToken(appCheckToken);
    } catch (error) {
        console.error("Error verifying App Check token:", error);
        return res.status(401).json({ error: "Unauthorized: Invalid App Check token" });
    }

    // Enable CORS using the 'cors' middleware
    cors({
        origin: 'https://geminihackathonkang.web.app',
        methods: ['POST'],
        credentials: true,
    })(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).end();
        }

        const busboy = Busboy({ headers: req.headers });
        let imageBuffer;
        let imageFileName;

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname !== 'image') {
                file.resume();
                return;
            }

            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                imageBuffer = Buffer.concat(chunks);
                imageFileName = filename;
            });
        });

        busboy.on('finish', async () => {
            if (!imageBuffer) {
                return res.status(400).json({ error: "No image file uploaded" });
            }

            try {
                // Process the image using Sharp
                const processedImageBuffer = await sharp(imageBuffer)
                    .resize(512, 512)
                    .jpeg()
                    .toBuffer();
                
                // Create a temporary file path
                const tempFilePath = path.join(os.tmpdir(), `image_${Date.now()}.jpg`);

                // Save the processed image to the temporary file
                fs.writeFileSync(tempFilePath, processedImageBuffer);

                // Converts local file information to a GoogleGenerativeAI.Part object.
                function fileToGenerativePart(path, mimeType) {
                    return {
                        inlineData: {
                            data: Buffer.from(fs.readFileSync(path)).toString("base64"),
                            mimeType
                        },
                    };
                }
                
                // Turn images to Part objects
                const filePart1 = fileToGenerativePart(tempFilePath, "image/jpeg")
                const imageParts = [filePart1];

                // Prepare the prompt for Gemini
                const prompt = `
                ### Instruction 
                I'll post a photo and you'll create a scary, emotional story of 10 lines or so based on the time period, objects, places, props, and in the case of people or animals, their appearance, facial expressions, emotions, and actions.
                
                ### Example                 
                {"title": "The Haunted House","story": "The old house on the hill was said to be haunted. The locals whispered about strange lights and eerie sounds coming from the abandoned building. One night, a group of teenagers decided to investigate. As they entered the house, they felt a chill run down their spines. The air was thick with the smell of decay, and the floorboards creaked beneath their feet. Suddenly, a shadowy figure appeared in the darkness, its eyes glowing with an otherworldly light. The teenagers screamed in terror as the figure advanced towards them, its ghostly form reaching out to grab them. They ran for their lives, vowing never to return to the haunted house again."}                
                {"title": "The Witness", "story": "Her eyes, wide with terror, darted around the room, searching for something, someone. The silence was broken only by the frantic thumping of her heart, a drumbeat of fear in the suffocating stillness.  Her lips parted, a silent scream trapped in her throat, as if the very air was choked with dread.  The shadows danced on the wall, playing tricks on her eyes, making her fear grow, twisting the mundane into menacing. The only thing she could do was watch, wait, and pray that whatever it was she was seeing, whatever it was she was waiting for, would pass her by."}                
                {"title": "The Crooked Mirror", "story": "The antique shop was dusty and dim, each object whispering secrets of forgotten lives. I was drawn to a tarnished mirror, its frame warped and twisted like a gnarled branch. As I gazed into its depths, the reflection flickered. It wasn't me staring back, but a figure shrouded in darkness, its eyes glowing with an unearthly light. I gasped and stumbled back, the mirror's surface rippling as if alive, a cold hand reaching out from the depths."}                
                {"title": "The Empty House", "story": "The old house on the hill stood silent and watchful, its windows like vacant eyes staring down at the town. Years ago, it had been a bustling home, but now it was abandoned, a decaying monument to a life lived and lost. As I ventured inside, the air grew thick with the scent of decay and dust. A single candle flickered on the table, illuminating a faded photograph of a family, their faces now obscured by shadows. A shiver ran down my spine, and I knew I wasn't alone."}                
                {"title": "The Red Stain", "story": "The rain was relentless, hammering against the windowpane and blurring the world outside. As I sat in the darkened room, I noticed a crimson stain spreading across the carpet, growing larger with each passing moment. It seemed to pulse with a dark energy, whispering secrets of violence and despair. The smell of blood was heavy in the air, and I knew that this was no ordinary stain. It was a mark left by something monstrous, something that would not rest until it had consumed me."}                
                {"title": "The Shadow in the Hood", "story": "A figure cloaked in darkness, their face hidden beneath a hood that seemed to swallow the light.  Eyes, like pools of obsidian, gleam with an unholy fire. A mouth, a thin line of crimson, twitches with a sinister smile.  Their presence, a chill that seeps into your bones, a whisper of dread that hangs in the air.  The shadows cling to them, whispering secrets only they can hear.  They move with a grace that belies their unsettling purpose, a predator stalking its prey. The truth is hidden in the shadows, the darkness holds secrets, and the figure in the hood knows them all."}                
                {"title": "The Whispering Woods", "story": "The fog clung to the trees like a shroud, obscuring the path ahead. The figures moved through the mist, their faces hidden beneath dark hoods.  Their whispers, like the rustling of leaves, carried on the wind, a chilling chorus in the silent woods. The ground beneath their feet seemed to tremble, a subtle tremor that echoed with a sense of foreboding. They were not alone. The whispers grew louder, closer, and a cold fear crept into my heart.  I knew I wasn't safe in this place, a place where darkness lingered in the shadows and the whispers of forgotten souls filled the air. "}

                ## Additional requirements
                Create an additional "title_ko,story_ko" attribute for the description of the "title,story" attribute in the response JSON and translate it to Korean.
                `;

                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    safetySetting: [
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_UNSPECIFIED, threshold: HarmBlockThreshold.BLOCK_NONE },
                    ],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                const text = response.text();
                
                // Clean up the temporary file
                fs.unlinkSync(tempFilePath);

                // Return the structured response
                res.status(200).json(JSON.parse(text));

            } catch (error) {
                console.error("Error analyzing image:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });

        busboy.end(req.rawBody);
    });
});
import express from "express"
import cors from "cors"            //for cross origin requests
import multer from "multer"     //for file uploads
import {v4 as uuidv4} from "uuid"
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs"
// import { exec } from "child_process"        //not recommended to run on servers if we dont know what to do
// import { error } from "console"
// import { stderr, stdout } from "process"
import dotenv from "dotenv"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";



dotenv.config()

// // storage: multer middleware
// const storage=multer.diskStorage({
//     destination: function(req,file,callback){
//         callback(null,"./uploads")      //first parameter for error handling: since we are not handling errors, we specify null
//     },
//     filename: function(req,file,cb){
//         cb(null, file.fieldname + "-" + uuidv4() + path.extname(file.originalname))
//         //sets as <filename>-<uniqueid>.<its_extension>
//     }
// })
// //multer configuration
// const upload=multer({storage:storage})      //now this upload object is capable of handling a file

// AWS S3 Configuration
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
// AWS SQS Configuration
const sqs = new SQSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const pollQueue = async () => {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: process.env.SQS_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // enables long polling
    });

    const response = await sqs.send(command);

    if (response.Messages) {
      for (const message of response.Messages) {
        const body = JSON.parse(message.Body);const record = body.Records?.[0];

        if (record && record.s3) {
          const bucket = record.s3.bucket.name;
          const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
          console.log(`🟢 New upload detected: Bucket = ${bucket}, Key = ${key}`);
        }else {
            console.warn("⚠️ Received unexpected message format:", message.Body);
        }


        // Delete message to prevent reprocessing
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: process.env.SQS_URL,
          ReceiptHandle: message.ReceiptHandle,
        }));
      }
    }
  } catch (err) {
    console.error("Polling error:", err);
  }finally {
    // Schedule next poll
    setTimeout(pollQueue, 5000);
  }

};



// Multer Storage Configuration (Now Memory Instead of Disk)
const upload = multer({ storage: multer.memoryStorage() });



const app=express()
app.use(
    cors({
        origin:["http://localhost:3000","http://localhost:5173"],           //allow requests from react frontend
        credentials: true
    })
)

//custom middlewares and handlers
app.use((req,res,next)=>{
    res.header("Access-Control-Allow-Origin","*")       //allow trusted origins
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
})

app.use(express.json())         //allows us to work with json data
app.use(express.urlencoded({extended: true}))
// app.use("/uploads",express.static("uploads"))       //to serve static files on "/uploads" from uploads folder
//our data flow: we will upload video files to the uploads folder....and we send the location of segmented files to user
//in real world: buckets such as s3 are used and are sent from there

app.get("/",function(req,res){
    res.json({message:"Server started"})
})



// upload a file and convert it into segments
app.post("/upload",upload.single('file'),async(req,res)=>{
    // select small files for upload
    // console.log("file uploaded")
    // const lessonId=uuidv4();
    // const videoPath=req.file.path
    // const outputPath=`./uploads/courses/${lessonId}`        //directory of video to be streamed
    // const hlsPath=`${outputPath}/index.m3u8`            //m3u8 is plain text file that can be used to store URL paths of streaming audio or video info
    //of media track like timestamps

    
    // // if directory dont exists....create it
    // if(!fs.existsSync(outputPath)){
    //     fs.mkdirSync(outputPath,{recursive: true})
    // }
    
    // //ffmpeg command
    // const ffmpegCommand=`ffmpeg -i ${videoPath} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath}`;
    // // important to specify command in one line on windows: else can encounter errors due to unexpected new line encounters by ffmpeg
    // this takes a lot of time hence is not recommended to run in realworld: it is instead done 
    // on heavy machines with plenty of resources....here since we are using for proofOfConcept POC ..we r doing it

    //not to be used in production
    // exec(ffmpegCommand,(error,stdout,stderr)=>{
    //     if(error){
    //         console.log(`exec error: ${error}`)
    //     }
    //     console.log(`stdout: ${stdout}`)
    //     console.log(`stderr: ${stderr}`)

    //     const videoURL=`http://localhost:8000/uploads/courses/${lessonId}/index.m3u8`;

    //     res.json({
    //         message: "Video converted to hls format",
    //         videoURL: videoURL,
    //         lessonId: lessonId
    //     })
    //     // if video is long u will see multiple segments as segment000.ts,segment001.ts etc
    // })
    const lessonId = uuidv4();
    const fileKey = `courses/${lessonId}/${req.file.originalname}`;
    const params = {
        Bucket: process.env.S3_BUCKET,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
    };

    const command=new PutObjectCommand(params)

    try {
        const data = await s3.send(command);
        res.json({
            message: "Video uploaded to S3",
            videoURL: data.Location,
            lessonId: lessonId,
        });
    } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: "Failed to upload file" });
    }

})

app.listen(8000,function(){
    console.log("App listening at port 8000...")
    pollQueue();
})

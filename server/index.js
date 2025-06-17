import express from "express"
import cors from "cors"            //for cross origin requests
import multer from "multer"     //for file uploads
import {v4 as uuidv4} from "uuid"
import path from "path"
import fs from "fs"
import { exec } from "child_process"        //not recommended to run on servers if we dont know what to do
import { error } from "console"
import { stderr, stdout } from "process"

// storage: multer middleware
const storage=multer.diskStorage({
    destination: function(req,file,callback){
        callback(null,"./uploads")      //first parameter for error handling: since we are not handling errors, we specify null
    },
    filename: function(req,file,cb){
        cb(null, file.fieldname + "-" + uuidv4() + path.extname(file.originalname))
        //sets as <filename>-<uniqueid>.<its_extension>
    }
})

//multer configuration
const upload=multer({storage:storage})      //now this upload object is capable of handling a file

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
app.use("/uploads",express.static("uploads"))       //to serve static files on "/uploads" from uploads folder

//our data flow: we will upload video files to the uploads folder....and we send the location of segmented files to user
//in real world: buckets such as s3 are used and are sent from there

app.get("/",function(req,res){
    res.json({message:"Server started"})
})



// upload a file and convert it into segments
app.post("/upload",upload.single('file'),function(req,res){
    // select small files for upload
    // console.log("file uploaded")
    const lessonId=uuidv4();
    const videoPath=req.file.path
    const outputPath=`./uploads/courses/${lessonId}`        //directory of video to be streamed
    const hlsPath=`${outputPath}/index.m3u8`            //m3u8 is plain text file that can be used to store URL paths of streaming audio or video info
    //of media track like timestamps
    console.log(hlsPath)



    // if directory dont exists....create it
    if(!fs.existsSync(outputPath)){
        fs.mkdirSync(outputPath,{recursive: true})
    }
    


    //ffmpeg command
    const ffmpegCommand=`ffmpeg -i ${videoPath} -codec:v libx264 -codec:a aac -hls_time 10 -hls_playlist_type vod -hls_segment_filename "${outputPath}/segment%03d.ts" -start_number 0 ${hlsPath}`;
    // important to specify command in one line on windows: else can encounter errors due to unexpected new line encounters by ffmpeg



    // this takes a lot of time hence is not recommended to run in realworld: it is instead done 
    // on heavy machines with plenty of resources....here since we are using for proofOfConcept POC ..we r doing it

    //not to be used in production
    exec(ffmpegCommand,(error,stdout,stderr)=>{
        if(error){
            console.log(`exec error: ${error}`)
        }
        console.log(`stdout: ${stdout}`)
        console.log(`stderr: ${stderr}`)

        const videoURL=`http://localhost:8000/uploads/courses/${lessonId}/index.m3u8`;

        res.json({
            message: "Video converted to hls format",
            videoURL: videoURL,
            lessonId: lessonId
        })
        // if video is long u will see multiple segments as segment000.ts,segment001.ts etc
    })
})

app.listen(8000,function(){
    console.log("App listening at port 8000...")
})



// workflow:file upload through multer
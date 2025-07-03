import express from "express"
import cors from "cors"            //for cross origin requests
import multer from "multer"
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs"
import dotenv from "dotenv"
import { Buffer } from "buffer"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { EC2Client, RunInstancesCommand, DescribeInstancesCommand, waitUntilInstanceRunning} from "@aws-sdk/client-ec2";
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand, DescribeInstanceInformationCommand } from "@aws-sdk/client-ssm";


// declare global variables
let globalLessonId = null;
let globalFileName = null;


dotenv.config()


//AWS Ec2 configuration
const ec2 = new EC2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const ssm = new SSMClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
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
        const body = JSON.parse(message.Body);
        const record = body.Records?.[0];

        if (record && record.s3) {
          const bucket = record.s3.bucket.name;
          const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
          console.log(`🟢 New upload detected: Bucket = ${bucket}, Key = ${key}`);
        }else {
            console.warn("⚠️ Received unexpected message format:", message.Body);
        }

        //here run dockercontainer process files and once over...then....

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



async function waitUntilInstanceSSMReady(instanceId, maxAttempts = 15, interval = 10000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Check EC2 instance state
      const ec2State = await ec2.send(new DescribeInstancesCommand({
        InstanceIds: [instanceId]
      }));
      const state = ec2State.Reservations?.[0]?.Instances?.[0]?.State?.Name || "unknown";
      // Check SSM management status
      const ssmInfo = await ssm.send(new DescribeInstanceInformationCommand({}));
      const managed = ssmInfo.InstanceInformationList?.find(info => info.InstanceId === instanceId);

      console.log(`🔍 [Attempt ${attempt + 1}] EC2 State: ${state} | SSM Managed: ${!!managed}`);

      if (managed) {
        console.log("✅ Instance is now managed by SSM");
        return;
      }
    } catch (err) {
      console.warn(`⚠️ Error during SSM/EC2 check (attempt ${attempt + 1}):`, err.message);
    }

    await new Promise(res => setTimeout(res, interval));
  }

  throw new Error("❌ Instance did not register with SSM in time.");
}




async function launchTranscodingInstance(lessonId,fileName) {
  const userDataScript = `
#!/bin/bash
set -e

# Update and install basic packages
apt-get update -y
apt-get install -y unzip curl

# Install AWS CLI
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install

# Install SSM agent (works for most Ubuntu AMIs)
REGION="${process.env.AWS_REGION}"
curl "https://s3.amazonaws.com/amazon-ssm-${process.env.AWS_REGION}/latest/debian_amd64/amazon-ssm-agent.deb" -o "ssm.deb"
dpkg -i ssm.deb
systemctl enable amazon-ssm-agent
systemctl start amazon-ssm-agent

echo "✅ Finished user data bootstrapping"
`;
  const scriptLines = [
`#!/bin/bash`,
`set -e`,
`LOGFILE='/home/ubuntu/debug-${lessonId}.log'`,
`exec > >(tee -a "$LOGFILE") 2>&1`,
`trap 'echo "Script failed! Uploading crash log..." && aws s3 cp "$LOGFILE" s3://${process.env.S3_BUCKET}/logs/${lessonId}_crash.log' ERR`,

"(",
"  while true; do",
"    sleep 60",
`    aws s3 cp "$LOGFILE" s3://${process.env.S3_BUCKET}/logs/${lessonId}_partial.log || echo "⚠️ Partial log upload failed"`,
"  done",
") &",

`echo "EC2 boot started at $(date)"`,
`sudo apt update && echo "apt update complete"`,
`sudo apt install -y unzip curl docker.io || echo "⚠️ apt install fallback used"`,
`sudo curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"`,
`sudo unzip awscliv2.zip`,
`sudo ./aws/install`,
`sudo usermod -aG docker ubuntu`,
`mkdir -p /home/ubuntu/videos`,
`mkdir -p /home/ubuntu/dockerbuild && cd /home/ubuntu/dockerbuild`,
`echo "Created working directories"`,

"# Configure credentials",
`aws configure set aws_access_key_id '${process.env.AWS_ACCESS_KEY_ID}'`,
`aws configure set aws_secret_access_key '${process.env.AWS_SECRET_ACCESS_KEY}'`,
`aws configure set region '${process.env.AWS_REGION}'`,
`echo "AWS credentials configured"`,

`aws sqs send-message \
  --queue-url ${process.env.SQS_URL} \
  --message-body '{\"status\":\"configured aws credentials\"}'`,

"# Build Docker image",
`aws s3 cp s3://${process.env.S3_BUCKET}/Dockerfile .  && echo "Dockerfile downloaded"`,
`sudo docker build -t videotranscoder . && echo "Docker image built"`,

`aws sqs send-message \
  --queue-url ${process.env.SQS_URL} \
  --message-body '{\"status\":\"Docker image built successfully\"}'`,


"# Pull videos and scripts",
`cd /home/ubuntu/videos`,
`aws s3 sync s3://${process.env.S3_BUCKET}/courses/ /home/ubuntu/videos && echo "Synced videos"`,
`aws s3 cp s3://${process.env.S3_BUCKET}/encode_hls.sh .`,
`aws s3 cp s3://${process.env.S3_BUCKET}/generate_master_playlist.sh .`,
`echo "Imported bash files"`,

`aws sqs send-message \
  --queue-url ${process.env.SQS_URL} \
  --message-body '{\"status\":\"Copied required files from s3\"}'`,

`cd ../dockerbuild`,

"# Run transcoding container",
`sudo docker run \
  --entrypoint /bin/bash -v /home/ubuntu/videos:/home/app/videos videotranscoder \
  -c "cd /home/app/videos && \
  chmod +x *.sh && \
  mkdir -p outputs/stream_{0..5} && \
  ./encode_hls.sh ${lessonId}/${fileName} && \
  ./generate_master_playlist.sh && \
  exit
"`,

`echo "Docker transcoding completed"`,

`aws sqs send-message \
  --queue-url ${process.env.SQS_URL} \
  --message-body '{\"status\":\"Task done and container destroyed\"}'`,


"# Sync results back to S3",
`aws s3 sync /home/ubuntu/videos/outputs s3://${process.env.S3_BUCKET}/courses/${lessonId}/`,
`echo "Synced outputs to S3"`,


`aws s3 cp "$LOGFILE" s3://${process.env.S3_BUCKET}/logs/${lessonId}.log`,
`echo "Uploaded debug log"`,

"# Notify before shutdown",
`aws sqs send-message \
  --queue-url ${process.env.SQS_URL} \
  --message-body '{\"status\":\"Sync complete. Preparing to shutdown...\"}'`,

"# Wait a few seconds to ensure message is sent",
`sleep 10`,

"# Shut down",
`sudo shutdown -h now`,
]
  const command = new RunInstancesCommand({
    ImageId: process.env.EC2_AMI_ID, // Replace with Ubuntu AMI ID for eu-north-1
    InstanceType: "t3.micro",
    MaxCount: 1,
    MinCount: 1,
    IamInstanceProfile: {
      Name: "EC2S3TranscodeRole"
    },
    TagSpecifications: [
      {
        ResourceType: "instance",
        Tags: [
          { Key: "Purpose", Value: "VideoTranscoder" },
          { Key: "Lesson", Value: lessonId }
        ]
      }
    ],
    // No KeyName specified → launches without SSH key
    UserData: Buffer.from(userDataScript).toString("base64")
  });
  
  const result = await ec2.send(command);
  const instanceId = result.Instances?.[0]?.InstanceId;
  console.log(`🚀 Transcoder launched: ${instanceId}`);

  
  // 2) Wait until it's ‘running’
  await waitUntilInstanceRunning({
    client: ec2,
    maxWaitTime: 120,      // seconds
    minDelay: 5,
    maxDelay: 15
  }, { InstanceIds: [instanceId] });
  console.log(`✅ Instance is running`);
  await waitUntilInstanceSSMReady(instanceId); 

  const sendCmd = await ssm.send(new SendCommandCommand({
    InstanceIds: [instanceId],
    DocumentName: "AWS-RunShellScript",
    Comment: `Transcode job for lesson ${lessonId}`,
    Parameters: { commands: scriptLines }
  }));
  const commandId = sendCmd.Command.CommandId;
  console.log(`📨 SSM Command sent: ${commandId}`);

  let invocation;
  do {
    await new Promise(r => setTimeout(r, 5000)); // wait 5s
    invocation = await ssm.send(new GetCommandInvocationCommand({
      CommandId: commandId,
      InstanceId: instanceId
    }));
    console.log(`⏳ Transcode status: ${invocation.Status}`);
  } while (invocation.Status === "InProgress");
  
  console.log(`✅ Final SSM status: ${invocation.Status}`);
  console.log("STDOUT:\n", invocation.StandardOutputContent);
  console.error("STDERR:\n", invocation.StandardErrorContent);
}

//launchTranscodingInstance().catch(console.error);

const pollTranscodeCompletion = async () => {
  try {
    const command = new ReceiveMessageCommand({
      QueueUrl: process.env.SQS_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    });

    const response = await sqs.send(command);

    if (response.Messages) {
      for (const message of response.Messages) {
        try {
          const body = JSON.parse(message.Body);

          if (body.status ) {
            console.log(`Status update from Ec2: ${body.status}`);
            if (body.lessonId) {
              console.log(`📘 Lesson ID associated: ${body.lessonId}`);
            }
          } else if (body.Records) {
            // Ignore S3-style messages in the completion poller
            console.log("ℹ️ Ignored S3 message in completion poller(some object may have been created).");
          } else {
            console.warn("⚠️ Unexpected completion message format:", message.Body);
          }

          // Delete message after successful processing
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: process.env.SQS_URL,
            ReceiptHandle: message.ReceiptHandle,
          }));
        } catch (e) {
          console.error("❌ Error parsing message:", e.message);
        }
      }
    }
  } catch (err) {
    console.error("📮 Completion queue polling error:", err);
  } finally {
    setTimeout(pollTranscodeCompletion, 10000); // keep polling
  }
};



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


const upload = multer({ storage: multer.memoryStorage() });

// upload a file and convert it into segments
app.post("/upload",upload.single('file'),async(req,res)=>{
    
    const lessonId = Date.now();
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

        // set the global constants to pass them to trancoding function
        globalLessonId = lessonId;
        globalFileName = req.file.originalname;

        res.json({
            message: "Video uploaded to S3",
            videoURL: data.Location,
            lessonId: lessonId,
            bashInputParameter: `${lessonId}/${req.file.originalname}`
        });
    } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({ error: "Failed to upload file" });
    }

})

app.listen(8000,function(){
    console.log("App listening at port 8000...")
    // pollQueue();

    pollTranscodeCompletion();

    // Poll for values lessonId and filename to be set and then launch
    const waitAndLaunch = () => {
        if (globalLessonId && globalFileName) {
            launchTranscodingInstance(globalLessonId, globalFileName).catch(console.error);
        } else {
            console.log("Waiting for upload...");
            setTimeout(waitAndLaunch, 1000);
        }
    };
    
    waitAndLaunch();

    setInterval(() => {
      console.log("💓 Server alive at", new Date().toISOString());
    }, 60000);
})

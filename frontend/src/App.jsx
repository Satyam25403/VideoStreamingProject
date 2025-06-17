import './App.css'
import {VideoPlayer} from "./VideoPlayer.jsx"
import { useRef, useState, useEffect } from 'react'


function App() {

  const playerRef= useRef(null)
  // const [videoLink, setVideoLink] = useState('')

  const videoLink="http://localhost:8000/uploads/courses/0005fa3a-1230-44c7-93be-d888e3f6575e/index.m3u8"


  // from docs of video.js
  const videoPlayerOptions={
    controls: true,
    responsive: true,
    fluid: true,
    sources: [
      {
        src: videoLink,
        type: "application/x-mpegURL"
      }
    ]
  }

  const handlePlayerReady = (player) => {
    console.log("Player is ready", player)
    playerRef.current = player
  }


  // // when component mounts
  // useEffect(() => {
  //   // define async function
  //   const fetchVideoLink=async()=>{
  //     try{
  //       const response=await fetch("http://localhost:8000/upload", {
  //         method: "POST",
  //         body: formData
  //       })
  //       const data=await response.json();

  //       setVideoLink(data.videoURL)
  //     }
  //     catch(error){
  //       console.log("Error fetching video Link: ",error)
  //     }
  //   }

  //   // function call
  //   fetchVideoLink()
  // }, [])
  


  return (
    <>
      <div>
        <h1>Video Player</h1>
      </div>
      {/* conditional rendering */}
      {
        videoLink?(
          <VideoPlayer
            options={videoPlayerOptions}
            onReady={handlePlayerReady}
          />
        ):(
          <h2>Loading video...</h2>
        )
      }
      
    </>
  )
}

export default App

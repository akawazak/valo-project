import React from 'react';
export default function Image({fill,unoptimized,priority,sizes,quality,loader,...props}:any){return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',...props.style}:props.style}/>;}

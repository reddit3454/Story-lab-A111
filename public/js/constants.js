// Extracted from app.js Phase 7 — static data constants shared across views.

export var IMAGE_MODELS = [
  { label: 'Juggernaut XL v11',            value: 'Juggernaut-XI-v11.safetensors'              },
  { label: 'Juggernaut XL v11 - Face ID',  value: 'Juggernaut-XI-v11.safetensors|faceid'       },
  { label: 'Juggernaut Ragnarok',           value: 'juggernautXL_ragnarokBy.safetensors'        },
  { label: 'Juggernaut Ragnarok - Face ID', value: 'juggernautXL_ragnarokBy.safetensors|faceid' },
  { label: 'Illustrious XL v2.0',           value: 'Illustrious-XL-v2.0.safetensors'           },
  { label: 'RealCartoon XL v7',             value: 'realcartoonXL_v7.safetensors'               },
  { label: 'RealCartoon XL v4',             value: 'realcartoonXL_v4/realcartoonXL_v4.safetensors' },
  { label: 'DreamShaper XL Lightning',      value: 'dreamshaperXL_lightningDPMSDE.safetensors'  }
];

export var TEXT_PREF_DEFAULTS = {
  fontSize:       18,
  lineHeight:     1.70,
  letterSpacing:  0.00,
  paragraphSpace: 0.6,
  maxWidth:       680
};

export var CHAT_COLOR_DEFAULTS = {
  userText:     '#d4e8d6',
  narratorText: '#e6e0c4'
};

export var NPC_COLOR_PALETTE = ['#d6cce8', '#c8dde8', '#e8d6c8', '#c8e8dd', '#e8ccd6', '#e8e0c8', '#cce8e4'];

export var HAIR_COLOR_OPTS = [
  ['Black','Black'],['Dark Brown','Dark Brown'],['Brown','Brown'],['Light Brown','Light Brown'],
  ['Blonde','Blonde'],['Platinum Blonde','Platinum Blonde'],['Auburn','Auburn'],
  ['Red','Red'],['Gray','Gray'],['White','White'],
  ['Pink','Pink'],['Blue','Blue'],['Purple','Purple'],['Green','Green'],['Other','Other']
];

export var HAIR_STYLE_OPTS = [
  ['Short','Short'],['Cropped','Cropped'],['Bob','Bob'],['Medium Length','Medium Length'],
  ['Long','Long'],['Very Long','Very Long'],['Wavy','Wavy'],['Curly','Curly'],
  ['Coily','Coily'],['Straight','Straight'],['Braided','Braided'],['Ponytail','Ponytail'],
  ['Bun','Bun'],['Pixie Cut','Pixie Cut']
];

export var BODY_TYPE_OPTS = [
  ['Slim','Slim'],['Petite','Petite'],['Athletic','Athletic'],['Average','Average'],
  ['Curvy','Curvy'],['Full Figured','Full Figured'],['Muscular','Muscular'],['Stocky','Stocky']
];

export var BREAST_SIZE_OPTS = [
  ['Flat','Flat'],['Small','Small'],['Medium','Medium'],['Large','Large'],['Very Large','Very Large']
];

export var BUTT_SIZE_OPTS = [
  ['Flat','Flat'],['Small','Small'],['Round','Round'],['Bubble','Bubble'],['Large','Large']
];

export var PENIS_STATE_OPTS = [
  ['soft','soft'],['semi-erect','semi-erect'],['erect','erect']
];

export var HEIGHT_OPTS = [
  ["Very Short (under 5ft)","Very Short (under 5ft)"],
  ["Short (5ft-5'3)","Short (5ft-5'3)"],
  ["Average (5'4-5'7)","Average (5'4-5'7)"],
  ["Tall (5'8-5'11)","Tall (5'8-5'11)"],
  ["Very Tall (6ft+)","Very Tall (6ft+)"]
];

export var EYE_COLOR_OPTS = [
  ['Brown','Brown'],['Dark Brown','Dark Brown'],['Hazel','Hazel'],['Green','Green'],
  ['Blue','Blue'],['Gray','Gray'],['Amber','Amber'],['Other','Other']
];

export var SKIN_TONE_OPTS = [
  ['Fair','Fair'],['Light','Light'],['Medium','Medium'],['Olive','Olive'],
  ['Tan','Tan'],['Brown','Brown'],['Dark Brown','Dark Brown'],['Deep','Deep']
];

export var AGE_RANGE_OPTS = [
  ['Young Teen (18)','Young Teen'],['Teen (18-19)','Teen'],['Young Adult (20-25)','Young Adult'],
  ['Adult','Adult'],['Mature','Mature']
];

export var EYE_SHAPE_OPTS = [
  ['Wide','Wide'],['Almond','Almond'],['Squinty','Squinty'],
  ['Round','Round'],['Hooded','Hooded']
];

export var NOSE_SHAPE_OPTS = [
  ['Small','Small'],['Pointy','Pointy'],['Button','Button'],
  ['Broad','Broad'],['Straight','Straight']
];

export var LIP_SHAPE_OPTS = [
  ['Thin','Thin'],['Wide','Wide'],['Full','Full'],
  ['Bow-shaped','Bow-shaped'],['Natural','Natural']
];

export var FACE_SHAPE_OPTS = [
  ['Oval','Oval'],['Round','Round'],['Angular','Angular'],['Heart','Heart'],
  ['Square','Square'],['High Cheekbones','High Cheekbones']
];

export var OUTFIT_STYLE_OPTS = [
  ['Casual','Casual'],['Sporty','Sporty'],['Tomboy','Tomboy'],['Elegant','Elegant'],
  ['Formal','Formal'],['Fantasy','Fantasy'],['Streetwear','Streetwear'],['Minimal','Minimal']
];

export var GENDER_OPTS = [
  ['Female','Female'],['Male','Male'],['Non-binary','Non-binary'],['Other','Other']
];

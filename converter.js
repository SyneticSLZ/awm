const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs').promises;
const path = require('path');

// Convert SQLite database to JSON file
async function convertDbToJson() {
  try {
    console.log('Starting conversion of SQLite database to JSON...');
    
    // Open the database
    const db = await open({
      filename: path.join(__dirname, 'warning_letters.db'),
      driver: sqlite3.Database
    });
    
    console.log('Successfully connected to the database');
    
    // Get all warning letters from database
    const warningLetters = await db.all('SELECT * FROM warning_letters');
    
    console.log(`Retrieved ${warningLetters.length} warning letters from database`);
    
    // Add ID field if not present
    warningLetters.forEach((letter, index) => {
      if (!letter.id) {
        letter.id = index + 1;
      }
    });
    
    // Write to JSON file
    const jsonPath = path.join(__dirname, 'warning_letters.json');
    await fs.writeFile(jsonPath, JSON.stringify(warningLetters, null, 2));
    
    console.log(`Successfully wrote data to ${jsonPath}`);
    console.log('Conversion completed!');
    
    // Close the database
    await db.close();
    
  } catch (error) {
    console.error('Error converting database to JSON:', error);
  }
}

// Run the conversion
convertDbToJson();
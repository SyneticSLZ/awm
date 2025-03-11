import json

# Specify the input and output file paths
input_file = "products.txt"  # Replace with your actual file path
output_file = "products_data.json"

# Read the file and process the data
with open(input_file, 'r') as f:
    lines = f.readlines()

# Extract headers from the first line
headers = lines[0].strip().split('~')

# Process the remaining lines into a list of dictionaries
data_list = []
for line in lines[1:]:  # Skip the header row
    if line.strip():  # Check if the line is not empty
        values = line.strip().split('~')
        # Ensure the number of values matches the number of headers
        if len(values) == len(headers):
            data_dict = dict(zip(headers, values))
            data_list.append(data_dict)
        else:
            print(f"Warning: Skipping malformed line with {len(values)} values: {line.strip()}")

# Convert the list of dictionaries to JSON
json_data = json.dumps(data_list, indent=2)

# Save the JSON data to a file
with open(output_file, 'w') as f:
    f.write(json_data)

# Print a sample of the JSON output (first 1000 characters) for verification
print("Sample JSON output (first 1000 characters):")
print(json_data[:1000])
print(f"\nFull JSON data saved to {output_file}")

import paramiko
import os

# Server details
hostname = "89.108.88.207"
port = 22
username = "root"
password = "hDxSikNSlsr6dMMe"

# Local and remote paths
local_file = "project.tar.gz"
remote_path = f"/root/{local_file}"

# Commands to execute
commands = [
    f"tar -xzf {remote_path} -C /root",
    "cd /root",
    "npm install",
    "nohup npm start &"
]
command_to_execute = " && ".join(commands)


# Create SSH client
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    # Connect to the server
    client.connect(hostname, port=port, username=username, password=password, timeout=30)
    print("Successfully connected to the server.")

    # Upload the file
    print(f"Uploading {local_file} to {remote_path}...")
    sftp = client.open_sftp()
    sftp.put(local_file, remote_path)
    sftp.close()
    print("File uploaded successfully.")

    # Execute the commands
    print(f"Executing command: {command_to_execute}")
    stdin, stdout, stderr = client.exec_command(command_to_execute, timeout=300)

    # Wait for the command to complete
    exit_status = stdout.channel.recv_exit_status()

    # Print the output
    print("--- stdout ---")
    stdout_output = stdout.read().decode()
    print(stdout_output)

    print("--- stderr ---")
    stderr_output = stderr.read().decode()
    print(stderr_output)

    if exit_status == 0:
        print("Deployment commands executed successfully.")
        # Check if the server is running on port 3001
        print("Checking if the server is running on port 3001...")
        check_command = "netstat -tuln | grep 3001"
        stdin, stdout, stderr = client.exec_command(check_command)
        output = stdout.read().decode()

        if "0.0.0.0:3001" in output or ":::3001" in output:
            print("Express server has successfully started on port 3001.")
        else:
            print("Could not confirm if the server has started on port 3001. Please check the server logs.")
            print("Output of netstat command:", output)
            print("Error of netstat command:", stderr.read().decode())
    else:
        print(f"Deployment command failed with exit status {exit_status}")

except Exception as e:
    print(f"An error occurred: {e}")

finally:
    # Close the connection
    if client:
        client.close()
    print("Connection closed.")
